/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["node-pty", "ws", "bufferutil", "utf-8-validate", "chokidar", "fsevents"],
};

export default nextConfig;
