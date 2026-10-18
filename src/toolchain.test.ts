import { describe, expect, it } from "vitest";
import config from "../vite.config";

describe("development toolchain", () => {
  it("serves on the container's forwarded port without silently changing it", () => {
    expect(config.server).toMatchObject({
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
    });
  });

  it("discovers engine tests without requiring a browser", () => {
    expect(config.test).toMatchObject({
      environment: "node",
      include: ["src/**/*.test.{ts,tsx}"],
    });
  });
});
