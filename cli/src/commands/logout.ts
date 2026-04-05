import { writeConfigFile } from "../config";

export function runLogout(): void {
  writeConfigFile({ token: "" });
  console.log("Logged out. Token removed from config.");
}
