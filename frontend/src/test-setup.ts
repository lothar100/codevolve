import "@testing-library/jest-dom";

// Recharts uses ResizeObserver internally. jsdom does not implement it.
// Provide a no-op polyfill so chart components render without errors in tests.
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
