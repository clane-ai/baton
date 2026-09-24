// Mirrors clane-client/jest.config.js so every spec here runs unchanged on the
// platform. Only `roots` differs: the staging tree nests clane-client/src.
export default {
  roots: ['<rootDir>/clane-client/src'],
  testEnvironment: 'jsdom',
  testEnvironmentOptions: {
    url: 'http://localhost:3091',
  },
  moduleNameMapper: {
    '\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\.(svg|png|jpg|jpeg|gif|webp|avif|woff2?)$': '<rootDir>/test/fileStub.cjs',
  },
  restoreMocks: true,
  testTimeout: 15000,
  transform: {
    '^.+\.(ts|tsx|js|jsx)$': 'babel-jest',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
