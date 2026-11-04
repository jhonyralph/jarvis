import { test, expect } from "@playwright/test";
import { installPersonalAssistantFixture, type FixtureAudit } from "./fixture";
let audit: FixtureAudit;
test.beforeEach(async ({ page }) => { audit = await installPersonalAssistantFixture(page, { conversation: true }); await page.clock.install(); await page.goto("/"); });
test.afterEach(() => { expect(audit.pageErrors).toEqual([]); expect(audit.externalRequests).toEqual([]); });

test("conversation restores history, selects a task and separates stop/cancel/end", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "Conversa e resultados", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Conversar com Jarvis e acompanhar tarefas" });
  await expect(panel.getByText("Jarvis: Conversa anterior recuperada.")).toBeVisible();
  await expect(panel.getByText("Pedido antes da queda", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Selecionar", exact: true }).first().click();
  await expect(panel.getByText(/Tarefa em foco: Backend/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('conversation.png'), fullPage: true });
  await panel.getByLabel("Mensagem para o Jarvis").fill("status");
  await panel.getByRole("button", { name: "Conversar", exact: true }).click();
  await expect(panel.getByText(/Jarvis: Resposta curta/)).toBeVisible();
  await panel.getByRole("button", { name: "Parar áudio", exact: true }).click();
  await panel.getByText('Correção e encerramento',{exact:true}).click();
  await panel.getByRole("button", { name: "Cancelar tarefa selecionada", exact: true }).click();
  await panel.getByRole("button", { name: "Encerrar conversa", exact: true }).click();
  const sent = await page.evaluate(() => (window as any).__jarvisTest.sent.filter((f: any) => f.t === 'conversation_request').map((f: any) => f.text));
  expect(sent).toEqual(['status','Pare de falar','Cancele esta tarefa','Encerre a conversa']);
});

test("decision has an explicit source and diagnostics exposes devices ahead of advanced settings", async ({ page }) => {
  await page.getByRole("button", { name: "Conversa e resultados", exact: true }).click();
  await page.getByRole("button", { name: "Guardar decisão / responsabilidade", exact: true }).first().click();
  const memory=page.getByRole('dialog',{name:'Guardar informação com origem'});
  await memory.getByLabel('Tipo de informação').selectOption('responsibility');
  await memory.getByLabel('Decisão ou responsabilidade').fill('Jonathan revisa a API.');
  await memory.getByRole('button',{name:'Guardar',exact:true}).click();
  await expect(page.getByText('Guardado com a tarefa de origem.',{exact:true})).toBeVisible();
  const saved=await page.evaluate(()=>(window as any).__jarvisTest.sent.find((f:any)=>f.t==='conversation_memory'));
  expect(saved).toMatchObject({taskId:'task-live',kind:'responsibility',value:'Jonathan revisa a API.'});
  await page.getByRole('button',{name:'Fechar',exact:true}).click();
  await page.getByRole('button',{name:'Diagnóstico de voz',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Teste sua voz',exact:true})).toBeVisible();
  await expect(page.getByLabel('Microfone deste aparelho',{exact:true})).toBeVisible();
  await expect(page.getByText('Avançado · modelos, fim de fala e armazenamento',{exact:true})).toBeVisible();
});

test("invalid playback reports error, never successful completion", async ({ page }) => {
  await expect(page.getByRole('button',{name:'Conversa e resultados',exact:true})).toBeVisible();
  await page.evaluate(()=>(window as any).__jarvisTest.emit({t:'tts',qid:'invalid-audio',audio:'%%%invalid',sessionId:'session-live',runnerId:'local'}));
  await expect.poll(async()=>page.evaluate(()=>(window as any).__jarvisTest.sent.find((f:any)=>f.t==='tts_played'&&f.qid==='invalid-audio')?.status)).toBe('error');
  expect(await page.evaluate(()=>(window as any).__jarvisTest.sent.some((f:any)=>f.t==='tts_started'&&f.qid==='invalid-audio'))).toBe(false);
});

test("lost audio ACK retries the same captured request and stops after durable acknowledgement", async ({ page }) => {
  await expect(page.getByRole('button',{name:'Conversa e resultados',exact:true})).toBeVisible();
  await page.getByLabel('Uso do microfone').selectOption('dictation');
  await page.locator('#mic').click();
  await expect(page.locator('#mic')).toHaveClass(/on/);
  await page.waitForTimeout(250); // fake browser microphone; no real ambient audio is recorded
  await page.locator('#mic').click();
  const sent = () => page.evaluate(()=>(window as any).__jarvisTest.sent.filter((f:any)=>f.t==='voice'));
  await expect.poll(async()=>(await sent()).length).toBe(1);
  const original=(await sent())[0];expect(original.dictation).toBe(true);expect(original.audio.length).toBeGreaterThan(0);
  await page.clock.runFor(21000);
  await expect.poll(async()=>(await sent()).length).toBeGreaterThan(1);
  expect((await sent()).every((f:any)=>f.vtid===original.vtid&&f.audio===original.audio)).toBe(true);
  await page.evaluate(id=>(window as any).__jarvisTest.emit({t:'voice_ack',vtid:id}),original.vtid);
  await page.clock.runFor(50);
  const count=(await sent()).length;
  await page.clock.runFor(21000);
  expect((await sent()).length).toBe(count);
});
