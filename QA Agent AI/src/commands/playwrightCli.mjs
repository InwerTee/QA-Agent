import { spawn } from "node:child_process";
import { isExecutableCommand } from "./schema.mjs";

export function toPlaywrightCliArgs(command) {
  const args = command.args ?? {};

  switch (command.type) {
    case "open":
      return args.url ? ["open", String(args.url)] : ["open"];
    case "goto":
      return ["goto", required(args.url, "goto.url")];
    case "snapshot":
      return args.filename ? ["snapshot", "--filename", String(args.filename)] : ["snapshot"];
    case "click":
      return ["click", required(args.target, "click.target")];
    case "fill":
      return ["fill", required(args.target, "fill.target"), required(args.value, "fill.value")];
    case "press":
      return ["press", required(args.key, "press.key")];
    case "select":
      return ["select", required(args.target, "select.target"), required(args.value, "select.value")];
    case "screenshot":
      return args.filename ? ["screenshot", "--filename", String(args.filename)] : ["screenshot"];
    case "close":
      return ["close"];
    case "assert_text":
    case "assert_url":
    case "assert_snapshot_contains":
      return undefined;
    default:
      throw new Error(`Unsupported command type: ${command.type}`);
  }
}

export async function executeCommand(command, options = {}) {
  if (!isExecutableCommand(command)) {
    return {
      status: "blocked",
      command,
      stdout: "",
      stderr: `Command ${command.id} is not executable under current safety rules.`
    };
  }

  const cliArgs = toPlaywrightCliArgs(command);
  if (!cliArgs) {
    return {
      status: "skipped",
      command,
      stdout: "",
      stderr: "Assertion commands are evaluated by the QA layer, not sent directly to playwright-cli yet."
    };
  }

  if (!options.execute) {
    return {
      status: "dry_run",
      command,
      argv: [playwrightCommand(), ...cliArgs],
      stdout: "",
      stderr: ""
    };
  }

  return runProcess(playwrightCommand(), cliArgs, options);
}

function playwrightCommand() {
  return process.env.PLAYWRIGHT_CLI_COMMAND || "playwright-cli";
}

function required(value, label) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error(`Missing required command argument: ${label}`);
  }
  return String(value);
}

function runProcess(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      shell: false,
      env: process.env
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk).toString("utf8")));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk).toString("utf8")));
    child.on("error", (error) => {
      resolve({
        status: "error",
        command: { tool: command, args },
        stdout: stdout.join(""),
        stderr: error.message
      });
    });
    child.on("close", (code) => {
      resolve({
        status: code === 0 ? "completed" : "error",
        command: { tool: command, args },
        exit_code: code,
        stdout: stdout.join(""),
        stderr: stderr.join("")
      });
    });
  });
}
