import { test, expect } from "@playwright/test";
import { installPersonalAssistantFixture, type FixtureAudit } from "./fixture";
import { buildConversationInbox } from "../../apps/hub/src/conversationInbox";
import type { ConversationTask } from "../../apps/hub/src/conversation";
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

test("5000 tasks and a 22-million-character legacy summary keep polling, DOM and typing bounded", async ({ page }, testInfo) => {
  const tasks: ConversationTask[] = Array.from({ length: 5000 }, (_, i) => ({ id: `scale-${i}`, runnerId: 'local', sessionId: `session-${i}`,
    title: `Escala ${i}`, state: 'succeeded', updatedAt: 5000-i, origin: 'Projeto', needsInput: false, canCancel: false,
    summary: i===0 ? 'x'.repeat(22_350_827) : 'Resultado preservado' }));
  let preferences: any = {quiet:false,seen:{}}, lastRequest: any = {}, maxBytes=0;
  await page.exposeFunction('__scaleInbox', (message: any) => {
    if(message.t==='conversation_list')lastRequest=message;
    if(message.taskId){const task=tasks.find(t=>t.id===message.taskId)!;preferences={...preferences,task:{runnerId:task.runnerId,sessionId:task.sessionId}};}
    const frame=buildConversationInbox(tasks,preferences,lastRequest,[]);
    maxBytes=Math.max(maxBytes,Buffer.byteLength(JSON.stringify(frame)));
    return frame;
  });
  await page.evaluate(()=>{(window as any).__jarvisTest.conversationResponder=(window as any).__scaleInbox;});
  await page.clock.runFor(10010);
  await expect.poll(()=>lastRequest.summaryOnly).toBe(true);
  await expect(page.locator('.conversation-task')).toHaveCount(0);
  await page.locator('#input').fill('Meu rascunho continua aqui');
  await page.clock.runFor(10010);
  await expect(page.locator('#input')).toHaveValue('Meu rascunho continua aqui');
  await page.getByRole('button',{name:'Conversa e resultados',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'Conversar com Jarvis e acompanhar tarefas'});
  await expect(panel.locator('.conversation-task')).toHaveCount(50);
  await expect(panel.getByText('1–50 de 5000 tarefas',{exact:true})).toBeVisible();
  expect(await panel.locator('.conversation-task p').first().textContent()).toHaveLength(1200);
  await expect(panel.getByText(/Prévia do resultado/).first()).toBeVisible();
  await expect(panel.getByText(/Prévia do resultado/).nth(1)).toBeHidden();
  await panel.getByLabel('Mensagem para o Jarvis').fill('Texto sendo digitado');
  await page.evaluate(()=>{
    const state=window as any;state.__firstCard=document.querySelector('.conversation-task');state.__cardMutations=0;
    state.__cardObserver=new MutationObserver(records=>{state.__cardMutations+=records.length;});
    state.__cardObserver.observe(state.__firstCard.parentElement,{subtree:true,childList:true,characterData:true,attributes:true});
  });
  await page.clock.runFor(10010);
  await expect(panel.getByLabel('Mensagem para o Jarvis')).toBeFocused();
  await expect(panel.getByLabel('Mensagem para o Jarvis')).toHaveValue('Texto sendo digitado');
  expect(await page.evaluate(()=>(window as any).__firstCard===document.querySelector('.conversation-task'))).toBe(true);
  expect(await page.evaluate(()=>(window as any).__cardMutations)).toBe(0);
  await page.evaluate(()=>(window as any).__cardObserver.disconnect());
  // A changed card keeps its buttons/focus; an unchanged poll is not a full rebuild.
  await panel.getByRole('button',{name:'Selecionar',exact:true}).first().focus();
  tasks[0]={...tasks[0],state:'failed',updatedAt:6000};
  await page.clock.runFor(10010);
  await expect(panel.locator('.conversation-task').first()).toContainText('Falhou');
  await expect(panel.getByRole('button',{name:'Selecionar',exact:true}).first()).toBeFocused();
  expect(await page.evaluate(()=>(window as any).__firstCard===document.querySelector('.conversation-task'))).toBe(true);
  await panel.getByRole('button',{name:'Próxima página',exact:true}).click();
  await expect(panel.getByText('51–100 de 5000 tarefas',{exact:true})).toBeVisible();
  await expect(panel.locator('.conversation-task').first()).toContainText('Escala 50');
  await panel.getByRole('button',{name:'Selecionar',exact:true}).first().click();
  await expect(panel.getByText(/Tarefa em foco: Escala 50/)).toBeVisible();
  await panel.getByRole('button',{name:'Página anterior',exact:true}).click();
  await expect(panel.getByText('1–50 de 5000 tarefas',{exact:true})).toBeVisible();
  await expect(panel.getByText(/Tarefa em foco: Escala 50/)).toBeVisible();
  // Late replies from an older page must not overwrite the current page.
  await page.evaluate(()=>(window as any).__jarvisTest.emit({t:'conversation_inbox',requestId:'old-request',tasks:[],total:0,limit:50,offset:0}));
  await page.clock.runFor(10);
  await expect(panel.locator('.conversation-task')).toHaveCount(50);
  await panel.getByRole('button',{name:'Fechar',exact:true}).click();
  await expect(page.locator('.conversation-task')).toHaveCount(0);
  await page.clock.runFor(10010);
  await expect.poll(()=>lastRequest.summaryOnly).toBe(true);
  await expect(page.locator('#input')).toHaveValue('Meu rascunho continua aqui');
  await page.getByRole('button',{name:'Conversa e resultados',exact:true}).click();
  await expect(panel.locator('.conversation-task')).toHaveCount(50);
  await expect(panel.getByLabel('Mensagem para o Jarvis')).toHaveValue('Texto sendo digitado');
  await expect(panel.getByText(/Tarefa em foco: Escala 50/)).toBeVisible();
  await expect.poll(()=>lastRequest.summaryOnly).toBe(false);
  await page.screenshot({path:testInfo.outputPath('conversation-scale.png'),fullPage:true});
  expect(maxBytes).toBeLessThan(150_000);
  await testInfo.attach('bounded-payload.json',{body:JSON.stringify({tasks:5000,legacySummaryChars:22_350_827,maxResponseBytes:maxBytes,maxCards:50}),contentType:'application/json'});
});

test("legacy inboxes cannot build thousands of hidden cards or unbounded summary text", async ({ page }) => {
  await page.evaluate(()=>{
    const tasks=Array.from({length:5000},(_,i)=>({id:'old-'+i,runnerId:'local',sessionId:'s'+i,title:'Legado '+i,state:'failed',updatedAt:1,origin:'Projeto',summary:i===0?'x'.repeat(22_350_827):'ok'}));
    (window as any).__jarvisTest.emit({t:'conversation_inbox',tasks,preferences:{seen:{}},updates:[]});
  });
  await page.clock.runFor(10);
  await expect(page.locator('.conversation-task')).toHaveCount(0);
  // Hold the network response to inspect the legacy snapshot already in memory.
  await page.evaluate(()=>{(window as any).__jarvisTest.conversationResponder=()=>new Promise(()=>{});});
  await page.getByRole('button',{name:'Conversa e resultados',exact:true}).click();
  await expect(page.locator('.conversation-task')).toHaveCount(50);
  await expect(page.getByText('1–50 de 5000 tarefas',{exact:true})).toBeVisible();
  expect(await page.locator('.conversation-task p').first().textContent()).toHaveLength(1200);
  await page.getByRole('button',{name:'Próxima página',exact:true}).click();
  await expect(page.getByText('51–100 de 5000 tarefas',{exact:true})).toBeVisible();
});
