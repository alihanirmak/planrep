import { NextResponse } from "next/server";
import { z } from "zod";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { getSession } from "@/lib/auth";
import { getModels } from "@/lib/model";
import { buildPrompt, extractJson, toDef, ruleFallback } from "@/lib/ai/nl2report";
import { logAudit } from "@/lib/audit";
import { formatT } from "@/lib/i18n";
import { getServerT } from "@/lib/i18n-server";

const schema = z.object({ question: z.string().min(3).max(500) });

const AXET_BIN =
  process.env.AXET_CODE_BIN ??
  `${process.env.LOCALAPPDATA ?? ""}\\axet-code\\bin\\axet-code.exe`;

// Uzun prompt stdin uzerinden verilir (arguman uzunluk sinirina takilmasin)
function runAxet(prompt: string, t: (key: import("@/lib/i18n").TKey) => string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      AXET_BIN,
      ["run", "--quiet", "stdin'deki görevi uygula ve SADECE istenen JSON'u döndür"],
      { windowsHide: true }
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(t("err.axetTimeout")));
    }, 90000);
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.slice(0, 400) || formatT(t("err.axetExitCode"), { code: String(code) })));
    });
    child.stdin.write(prompt, "utf8");
    child.stdin.end();
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { question } = parsed.data;

  const models = getModels();
  if (models.length === 0) return NextResponse.json({ error: "no_models" }, { status: 400 });

  const { t } = await getServerT();
  let source: "axet" | "fallback" = "axet";
  let note: string | null = null;
  let def = null as ReturnType<typeof toDef> | null;

  if (fs.existsSync(AXET_BIN) && process.env.AXET_DISABLE !== "1") {
    try {
      const output = await runAxet(buildPrompt(question, models), t);
      const json = extractJson(output);
      if (json) {
        const candidate = toDef(json, models);
        if (!("error" in candidate)) def = candidate;
        else note = formatT(t("err.axetResponseUnparseable"), { detail: candidate.error });
      } else {
        note = t("err.axetNoJson");
      }
    } catch (e) {
      note = formatT(t("err.axetFailed"), {
        detail: e instanceof Error ? e.message.slice(0, 200) : t("err.generic"),
      });
    }
  } else {
    note = t("err.axetNotFound");
  }

  if (!def || "error" in def) {
    source = "fallback";
    const fb = ruleFallback(question, models);
    if ("error" in fb) {
      return NextResponse.json({ error: "unresolvable", note }, { status: 422 });
    }
    def = fb;
  }

  logAudit(session.id, "ai.query", undefined, undefined, { question, source });
  return NextResponse.json({ def, source, note });
}
