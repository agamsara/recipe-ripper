import type { NextConfig } from "next";

const isGhPages = process.env.GH_PAGES === "1";
const repo = "cookclip";

const nextConfig: NextConfig = {
  ...(isGhPages
    ? {
        output: "export",
        basePath: `/${repo}`,
        assetPrefix: `/${repo}/`,
        images: { unoptimized: true },
        trailingSlash: true,
      }
    : {}),
};

export default nextConfig;
