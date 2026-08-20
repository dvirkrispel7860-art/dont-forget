#!/usr/bin/env node
/**
 * The test runner: `npm test`.
 *
 * The suites test the app's real logic modules, not copies of them. They run on
 * plain Node with no framework, so there is nothing to install and nothing to
 * configure — which is also why they run identically on a laptop and in CI.
 *
 * How it works:
 *
 *  1. The modules under test are compiled to CommonJS in `tests/.build`, using
 *     tests/tsconfig.json — which extends the project's own, so the code is
 *     checked under the same rules it ships with.
 *  2. Each `*.test.js` is copied in beside that output and run.
 *  3. Every suite prints one `N passed, M failed` line; this totals them and
 *     exits non-zero if anything failed, which is what makes CI meaningful.
 *
 * Each suite stubs the platform it needs (expo-location, expo-notifications,
 * AsyncStorage, fetch, a fake clock) so the real module logic is exercised
 * without a device. What that cannot cover — a notification actually appearing
 * on a phone with the app closed — is called out in the README.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TESTS_DIR = __dirname;
const BUILD_DIR = path.join(TESTS_DIR, '.build');

/**
 * TypeScript's own entry point, run through node.
 *
 * Not `node_modules/.bin/tsc`: that is a .cmd shim on Windows and Node refuses to
 * spawn those directly (EINVAL). Calling the JS entry behaves identically on
 * every platform, which is the point — CI and a laptop must run the same thing.
 */
const TSC = path.join(TESTS_DIR, '..', 'node_modules', 'typescript', 'bin', 'tsc');

function compile() {
  process.stdout.write('compiling the modules under test... ');
  try {
    execFileSync(process.execPath, [TSC, '--project', path.join(TESTS_DIR, 'tsconfig.json')], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
    console.log('done');
  } catch (error) {
    console.log('FAILED\n');
    console.log(error.stdout || error.message);
    process.exit(1);
  }
}

/** The suites require the compiled modules as siblings, so they run from there. */
function stageSuites() {
  const suites = fs
    .readdirSync(TESTS_DIR)
    .filter((name) => name.endsWith('.test.js'))
    .sort();

  for (const suite of suites) {
    fs.copyFileSync(path.join(TESTS_DIR, suite), path.join(BUILD_DIR, suite));
  }
  return suites;
}

function run(suites) {
  let totalPassed = 0;
  let totalFailed = 0;
  const failedSuites = [];

  for (const suite of suites) {
    const name = suite.replace(/\.test\.js$/, '');
    let output = '';
    let crashed = false;

    try {
      output = execFileSync(process.execPath, [path.join(BUILD_DIR, suite)], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (error) {
      // A non-zero exit is how a suite reports failures, so its output still
      // matters — but a crash with no output is a failure of its own.
      output = (error.stdout || '') + (error.stderr || '');
      crashed = !/\d+ passed/.test(output);
    }

    const summary = output.match(/(\d+) passed, (\d+) failed/);
    const passed = summary ? Number(summary[1]) : 0;
    const failed = summary ? Number(summary[2]) : 0;

    totalPassed += passed;
    totalFailed += failed;

    if (crashed) {
      console.log(`\n✖ ${name}: crashed`);
      console.log(output.trim().split('\n').slice(-15).join('\n'));
      failedSuites.push(name);
      totalFailed += 1;
      continue;
    }

    console.log(`${failed === 0 ? '✔' : '✖'} ${name.padEnd(22)} ${passed} passed, ${failed} failed`);

    if (failed > 0) {
      failedSuites.push(name);
      // Only the failures, so the log stays readable.
      for (const line of output.split('\n')) {
        if (/^FAIL|^ {8}(got|want)/.test(line)) console.log('    ' + line.trim());
      }
    }
  }

  console.log(`\n${totalPassed} passed, ${totalFailed} failed`);
  if (failedSuites.length > 0) {
    console.log(`failing suites: ${failedSuites.join(', ')}`);
    process.exit(1);
  }
}

compile();
const suites = stageSuites();
if (suites.length === 0) {
  console.log('no *.test.js files found in tests/');
  process.exit(1);
}
console.log('');
run(suites);
