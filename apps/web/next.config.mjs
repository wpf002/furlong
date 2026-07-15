import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

// Load the monorepo root .env so NEXT_PUBLIC_* vars (e.g. NEXT_PUBLIC_API_URL)
// are available — Next only auto-loads .env from the app dir, not the root.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@furlong/shared'],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
  // @furlong/shared is consumed as TypeScript source and uses NodeNext-style
  // ".js" import specifiers that actually point at ".ts" files. Teach webpack to
  // resolve those the way tsc does.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    return config;
  },
};
export default nextConfig;
