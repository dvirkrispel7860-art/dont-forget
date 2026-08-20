import { useCallback, useEffect, useRef, useState } from 'react';
import {
  leaveNowContent,
  notificationChannel,
  notificationPermission,
  permissionState,
  requestPermission,
} from '../notifications';
import {
  cancelLeaveReminder,
  leaveRideKey,
  scheduleLeaveReminder,
} from '../notificationSchedule';
import { useStore } from '../store';
import { Destination } from '../types';
import { LeavePlan } from './leaveTime';

/**
 * "🔔 הזכר לי מתי לצאת" — one notification, at the moment the leave time arrives.
 *
 * No new notification system: this arms a timer and hands the result to the
 * existing `notificationChannel`, with the message built by `leaveNowContent` —
 * the builder seam notifications.ts already documents. Permission goes through
 * the existing `permissionState`/`requestPermission`, and the app-wide switch in
 * settings still has the final word.
 *
 * Where it can be delivered from depends on the channel, and the card says which:
 *
 *  - **native** — the notification is handed to iOS/Android, so it arrives with
 *    the app backgrounded or killed. `osHeld` is true and the card promises that.
 *  - **web** — a browser has nowhere to leave a future notification without a
 *    push server, so it only fires while the app is open. `osHeld` is false and
 *    the card says exactly that instead of over-promising.
 *
 * A pending reminder belongs to the ride it was armed for, not to whatever the
 * card happens to be showing. That distinction is the whole point: the moment the
 * leave time arrives the card moves on to the next ride, and a reminder tied to
 * the displayed plan would be cancelled at exactly the second it was meant to
 * fire. It still follows a *time* change for its own ride.
 */

export type LeaveReminderBlock =
  /** No delivery channel on this platform (a native build, for now). */
  | 'unsupported'
  /** The app-wide notifications switch is off. */
  | 'notifications-off'
  /** The browser refused, and cannot be asked again from here. */
  | 'denied';

export type LeaveReminderState = {
  /** True while a reminder is waiting for its moment. */
  armed: boolean;
  /** True once it has been delivered for this ride. */
  sent: boolean;
  /**
   * True when the operating system is holding the notification — and therefore
   * when it will arrive with the app closed. False on web.
   */
  osHeld: boolean;
  /** Why it cannot be armed, when it cannot. */
  blocked: LeaveReminderBlock | null;
  /** Arms it — may prompt for notification permission, so tie it to a tap. */
  arm: () => void;
  cancel: () => void;
};

export function useLeaveReminder(
  destination: Destination | undefined,
  plan: LeavePlan | null,
  /**
   * The stop the card is boarding from right now — the hand-picked one when
   * there is one, otherwise the one that was found.
   *
   * Passed separately because it is known even when `plan` is null: a stop the
   * user picked by hand has no measured distance, so there is no leave time to
   * compute, and yet the stop has plainly changed. Without this the pending
   * reminder would sit there invisibly and fire naming the old stop.
   */
  originStopCode?: number,
): LeaveReminderState {
  const { settings, isExiting } = useStore();
  /** The ride a reminder is waiting for, snapshotted when it was armed. */
  const [armedPlan, setArmedPlan] = useState<LeavePlan | null>(null);
  /** The stop that reminder is for, so a change of stop is detectable. */
  const [armedStopCode, setArmedStopCode] = useState<number | null>(null);
  const [permission, setPermission] = useState(() => permissionState());
  /** The ride a reminder has already been delivered for. */
  const [sentFor, setSentFor] = useState<string | null>(null);

  const channel = notificationChannel;
  const rideId = plan?.option.id ?? null;
  /** True when the OS will hold the notification for us. */
  const osHolds = channel?.canSchedule === true;

  const blocked: LeaveReminderBlock | null = !channel
    ? 'unsupported'
    : permission === 'unsupported'
      ? 'unsupported'
      : !settings.notifications
        ? 'notifications-off'
        : permission === 'denied'
          ? 'denied'
          : null;

  /** Keeps the synchronously-read permission honest on native. */
  useEffect(() => {
    let alive = true;
    void notificationPermission().then((next) => {
      if (alive) setPermission(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  /*
   * The boarding stop changed while a reminder was pending, so that reminder is
   * about a journey the user is no longer taking. Withdraw it at once — from the
   * OS as well as from here — and do not arm anything for the new stop: that is
   * the user's decision, made with the 🔔 button.
   *
   * Only a stop we can actually name counts. While a search is in flight there is
   * no current stop, and treating that as a change would throw away a perfectly
   * good reminder every time the card looked again.
   */
  useEffect(() => {
    if (!armedPlan || armedStopCode == null) return;
    if (originStopCode == null || originStopCode === armedStopCode) return;

    setArmedPlan(null);
    setArmedStopCode(null);
    if (destination) void cancelLeaveReminder(destination.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originStopCode, armedStopCode, armedPlan, destination?.id]);

  /** The armed ride's leave time moved (the timetable changed): follow it. */
  useEffect(() => {
    if (!armedPlan || !plan) return;
    if (plan.option.id !== armedPlan.option.id) return;
    if (plan.leaveAt === armedPlan.leaveAt) return;
    setArmedPlan(plan);
  }, [plan, armedPlan]);

  const content =
    destination && armedPlan
      ? leaveNowContent(destination, {
          lineNumber: armedPlan.option.lineNumber,
          stopName: armedPlan.option.boardStopName,
          departureAt: armedPlan.departureAt,
          walkMinutes: armedPlan.walkMinutes,
        })
      : null;

  /*
   * NATIVE — the notification is handed to the OS, so it arrives even with the
   * app closed. Re-running this on a leave-time change is what replaces a
   * notification for a bus that is no longer the answer: `scheduleLeaveReminder`
   * cancels the previous one for this destination before registering the new one.
   */
  useEffect(() => {
    if (!osHolds || !armedPlan || !destination || !content) return;
    if (sentFor === armedPlan.option.id) return;

    void scheduleLeaveReminder({
      destinationId: destination.id,
      content,
      at: armedPlan.leaveAt,
      rideKey: leaveRideKey(armedPlan.option.id, armedPlan.leaveAt),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [osHolds, armedPlan?.option.id, armedPlan?.leaveAt, sentFor, destination?.id]);

  /*
   * The clock that moves the button from "armed" to "sent".
   *
   * On web it also *delivers*, because nothing else will. On native it only
   * follows along — the OS has already delivered, and a second send here would
   * show the same reminder twice.
   */
  useEffect(() => {
    if (!armedPlan || !channel || !destination || !content) return;
    if (sentFor === armedPlan.option.id) return;
    if (!osHolds && permissionState() !== 'granted') return;

    const delay = Math.max(0, armedPlan.leaveAt - Date.now());
    const timer = setTimeout(() => {
      if (osHolds) {
        setSentFor(armedPlan.option.id);
        setArmedPlan(null);
        return;
      }
      void channel.deliver(content).then(() => {
        setSentFor(armedPlan.option.id);
        setArmedPlan(null);
      });
    }, delay);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armedPlan?.option.id, armedPlan?.leaveAt, sentFor, destination?.id, channel, osHolds]);

  /*
   * The departure being finished ("✅ מוכן לצאת") makes a pending reminder wrong:
   * the user has left. Only the true→false transition counts — on the plan screen
   * no departure is open yet, and treating that as "finished" would cancel a
   * reminder the moment it was armed.
   */
  const wasExiting = useRef(false);
  const exiting = destination ? isExiting(destination.id) : false;
  useEffect(() => {
    if (wasExiting.current && !exiting && destination) {
      setArmedPlan(null);
      setArmedStopCode(null);
      if (osHolds) void cancelLeaveReminder(destination.id);
    }
    wasExiting.current = exiting;
  }, [exiting, destination?.id, osHolds]);

  const arm = useCallback(() => {
    if (!channel || !plan) return;
    if (!settings.notifications) return;

    /** The stop this reminder belongs to — see the change-of-stop effect above. */
    const stopCode = originStopCode ?? plan.option.boardStopCode;

    const current = permissionState();
    if (current === 'granted') {
      setSentFor(null);
      setArmedPlan(plan);
      setArmedStopCode(stopCode);
      return;
    }
    if (current !== 'default') {
      setPermission(current);
      return;
    }

    // The tap is the "clear user action" the browser wants before prompting.
    void requestPermission().then((next) => {
      setPermission(next);
      if (next === 'granted') {
        setSentFor(null);
        setArmedPlan(plan);
        setArmedStopCode(stopCode);
      }
    });
  }, [channel, settings.notifications, plan, originStopCode]);

  const cancel = useCallback(() => {
    setArmedPlan(null);
    setArmedStopCode(null);
    // Withdraw it from the OS too, or it would still arrive.
    if (osHolds && destination) void cancelLeaveReminder(destination.id);
  }, [osHolds, destination?.id]);

  return {
    // Both flags describe the ride on screen, so the button never claims to be
    // armed for a ride the user is no longer looking at.
    armed: blocked == null && armedPlan != null && armedPlan.option.id === rideId,
    sent: sentFor != null && sentFor === rideId,
    osHeld: osHolds,
    blocked,
    arm,
    cancel,
  };
}
