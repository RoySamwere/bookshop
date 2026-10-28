/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  // Next 16 blocks dev scripts for non-localhost hosts, leaving the page stuck on the loader.
  allowedDevOrigins: ['127.0.0.1', '192.168.*.*'],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
