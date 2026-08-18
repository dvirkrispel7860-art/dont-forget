import { TransitProvider } from './provider';
import { strideProvider } from './strideProvider';

/**
 * The active transit data source. Screens import `transit` and nothing else, so
 * replacing the source is a one-line change here.
 */
export const transit: TransitProvider = strideProvider;

export { isStopIndexReady } from './strideProvider';
export * from './types';
export type { TransitProvider } from './provider';
