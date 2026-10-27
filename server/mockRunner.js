// Sahte koşucu: Claude Code kurulu olmayan yerde (bulut, demo, ekran görüntüsü)
// gerçek akışın şeklini taklit eder. MOCK=1 ile devreye girer.
import { randomUUID } from "node:crypto";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SCRIPTS = {
  default: (agent, prompt) => ([
    { kind: "text", text: `Tamam, ${agent.name} projesinde "${prompt.slice(0, 60)}" için önce yapıya bakıyorum.` },
    { kind: "tool", name: "TodoWrite", summary: "", input: { todos: [
      { content: "Mevcut yapıyı incele", status: "in_progress", activeForm: "Yapı inceleniyor" },
      { content: "Değişikliği uygula", status: "pending", activeForm: "Değişiklik uygulanıyor" },
      { content: "Testleri çalıştır", status: "pending", activeForm: "Testler çalışıyor" } ] } },
    { kind: "tool", name: "Glob", summary: "**/*.{ts,js,gd}", out: "src/main.js\nsrc/player.js\ntests/player.test.js" },
    { kind: "tool", name: "Read", summary: `${agent.cwd}/README.md`, out: "# Proje\nKısa açıklama…" },
    { kind: "tool", name: "TodoWrite", summary: "", input: { todos: [
      { content: "Mevcut yapıyı incele", status: "completed" },
      { content: "Değişikliği uygula", status: "in_progress" },
      { content: "Testleri çalıştır", status: "pending" } ] } },
    { kind: "text", text: "Yapı anlaşıldı. `src/player.js` içinde hareket fonksiyonunu güncelliyorum." },
    { kind: "tool", name: "Edit", summary: `${agent.cwd}/src/player.js`, input: { file_path: `${agent.cwd}/src/player.js`,
      old_string: "function move(dir) {\n  this.x += dir * SPEED;\n}", new_string: "function move(dir, dash = false) {\n  const speed = dash ? SPEED * 3 : SPEED;\n  this.x += dir * speed;\n}" } },
    { kind: "tool", name: "Bash", summary: "npm test", input: { command: "npm test", description: "Testleri çalıştır" }, out: "> test\n> vitest run\n\n ✓ tests/player.test.js (3)\n\n Test Files  1 passed (1)\n      Tests  3 passed (3)" },
    { kind: "tool", name: "Bash", summary: "git push", input: { command: "git push" }, error: true, out: "Bu komut için izin gerekiyor." },
    { kind: "tool", name: "TodoWrite", summary: "", input: { todos: [
      { content: "Mevcut yapıyı incele", status: "completed" }, { content: "Değişikliği uygula", status: "completed" }, { content: "Testleri çalıştır", status: "completed" } ] } },
    { kind: "final", text: "## Özet\n\nDash eklendi ve testler geçti:\n\n- `src/player.js` içinde `move()` artık `dash` parametresi alıyor\n- 3 test, 3 başarılı\n\n| Dosya | Değişiklik |\n|---|---|\n| src/player.js | +3 −2 |\n\n`git push` için iznim yoktu; istersen aşağıdan izin verebilirsin. Ayrıntı: [Vitest belgeleri](https://vitest.dev)" },
  ]),
};

export function runMock(agent, prompt, emit) {
  let killed = false;
  const sessionId = agent.sessionId || randomUUID();
  const steps = SCRIPTS.default(agent, prompt);
  const att = [...prompt.matchAll(/Ekli görsel: (.+)/g)].map((m) => m[1].trim());
  if (att.length) {
    steps.splice(0, steps.length,
      { kind: "text", text: "Eklediğin görsele bakıyorum." },
      ...att.map((p) => ({ kind: "tool", name: "Read", summary: p })),
      { kind: "final", text: `Görseli inceledim. Arayüzde bir başlık, solda bir menü ve sağda kartlar var.\n\nKarşılaştırma için aynı görsel: ${att[0]}` });
  }

  const promise = (async () => {
    emit({ type: "status", status: "thinking" });
    await wait(400);
    emit({ type: "init", sessionId, model: `${agent.model} (mock)`, tools: 12 });

    {
      const th = "Önce projenin yapısına bakmalıyım. README ve ana dosyayı okuyup değişikliğin nereye gireceğini belirleyeceğim.";
      emit({ type: "status", status: "thinking" });
      for (const w of th.split(/(\s+)/)) { if (killed) break; emit({ type: "thinking_delta", text: w }); await wait(40); }
      emit({ type: "thinking", text: th });
    }
    for (const step of steps) {
      if (killed) break;
      if (step.kind === "text" || step.kind === "final") {
        emit({ type: "status", status: "thinking" });
        await wait(500);
        for (const word of step.text.split(/(\s+)/)) {
          if (killed) break;
          emit({ type: "text_delta", text: word });
          await wait(18);
        }
        emit({ type: "text", text: step.text });
      } else if (step.kind === "tool") {
        const toolUseId = randomUUID().slice(0, 8);
        emit({ type: "tool_use", name: step.name, summary: step.summary, toolUseId, input: step.input || null });
        emit({ type: "status", status: "tool", tool: step.name });
        await wait(900);
        emit({ type: "tool_result", toolUseId, isError: !!step.error, content: step.out || "" });
      }
    }

    emit({ type: "rate_limit", info: { kind: "five_hour", status: "allowed", utilization: 0.23, resetsAt: Date.now() + 2.5 * 3600e3 } });
    emit({ type: "rate_limit", info: { kind: "seven_day", status: "allowed", utilization: 0.41, resetsAt: Date.now() + 3 * 86400e3 } });
    const result = {
      type: "result",
      isError: killed,
      subtype: killed ? "interrupted" : "success",
      text: killed ? "Durduruldu." : steps.at(-1).text,
      costUsd: 0.0123,
      durationMs: 6400,
      numTurns: 4,
      sessionId,
      contextTokens: 48200,
      permissionDenials: (agent._allowOnce || []).includes("Bash(git push)") ? [] : [{ tool: "Bash", input: { command: "git push" }, spec: "Bash(git push)" }],
      contextWindow: 1000000,
    };
    emit(result);
    emit({ type: "status", status: killed ? "error" : "done" });
    return result;
  })();

  return { promise, kill: () => { killed = true; } };
}
