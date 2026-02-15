/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Keep native modules out of webpack bundling
      config.externals.push("node-pty", "ws", "bufferutil", "utf-8-validate");
    }
    return config;
  },
};

export default nextConfig;
