import '@testing-library/jest-dom';

// react-dom/server (browser build) requires TextEncoder/TextDecoder from Node.
// jsdom doesn't provide them, so polyfill here before any test module loads.
const { TextEncoder, TextDecoder } = require('util');
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = TextDecoder;
}
