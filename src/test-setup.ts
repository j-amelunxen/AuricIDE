import '@testing-library/jest-dom/vitest';

// jsdom implements no layout, so it ships no scrollIntoView. Components that
// keep a view pinned to its newest content call it on every update; without a
// stub the component crashes in tests for a reason that has nothing to do with
// the behaviour under test.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
