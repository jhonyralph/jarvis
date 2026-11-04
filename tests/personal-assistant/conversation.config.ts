import base from "./playwright.config";
import { resolve } from "node:path";
export default { ...base, testMatch: "conversation.spec.ts", outputDir: resolve(__dirname, "artifacts/conversation"),
  use: { ...base.use, launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } } };
