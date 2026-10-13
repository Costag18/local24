import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Camera stills come straight from the municipal/provincial hosts. They are
  // plain <img> tags rather than next/image so a dead camera degrades to an
  // onError badge instead of a build-time optimisation failure.
  eslint: { ignoreDuringBuilds: true },
  // node:sqlite is a built-in; keep it external so Next does not try to bundle it.
  serverExternalPackages: ["node:sqlite"],
};

export default nextConfig;
