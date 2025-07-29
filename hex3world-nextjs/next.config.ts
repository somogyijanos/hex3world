/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable experimental features for better Three.js support
  experimental: {
    // Ensure proper handling of ES modules
    esmExternals: true,
  },
  // Webpack configuration for Three.js
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack: (config: any, { buildId, dev, isServer, defaultLoaders, webpack }: any) => {
    // Handle Three.js addons properly
    config.resolve.alias = {
      ...config.resolve.alias,
      'three/examples/jsm': 'three/examples/jsm',
    };
    
    return config;
  },
  // Transpile Three.js modules
  transpilePackages: ['three'],
};

export default nextConfig;
