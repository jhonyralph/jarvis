/* Conversation is independent of the project composer and its running agent. */
(function (root) {
  'use strict';
  root.createJarvisConversation = function (api) {
    const el = (tag, text, parent) => { const n = document.createElement(tag); if (text) n.textContent = text; if (parent) parent.append(n); return n; };
    const button = (text, parent, fn) => { const n = el('button', text, parent); n.type = 'button'; n.onclick = fn; return n; };
    const style = el('style'); style.textContent = '.conversation-bar[hidden]{display:none}.conversation-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0}.conversation-bar small{flex:1;min-width:120px}.conversation-dialog{color:var(--text,#eee);background:var(--bg,#161b24);border:1px solid #627086;border-radius:14px;width:min(760px,94vw);max-height:88vh;padding:20px}.conversation-dialog::backdrop{background:#0009}.conversation-dialog header,.conversation-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.conversation-dialog header strong{flex:1}.conversation-dialog textarea{width:100%;min-height:70px;box-sizing:border-box;margin:8px 0}.conversation-dialog select{max-width:100%}.conversation-log{max-height:220px;overflow:auto;white-space:pre-wrap}.conversation-log p,.conversation-task{padding:12px;background:#80808012;border-radius:8px;border:1px solid #80808044}.conversation-task p{white-space:pre-wrap;max-height:180px;overflow:auto}.conversation-task small{display:block;overflow-wrap:anywhere;margin:5px 0}.conversation-task{margin-top:10px}.conversation-dialog button,.conversation-bar button,.conversation-dialog select{min-height:36px}.conversation-dialog [role=status]{min-height:1.5em}.conversation-dialog{box-sizing:border-box;overscroll-behavior:contain}.conversation-dialog textarea{background:#ffffff08;border:1px solid #697386;border-radius:8px;color:inherit;font:inherit;padding:12px;resize:vertical}.conversation-dialog button{background:#ffffff08;border:1px solid #ffffff26;color:inherit;font-size:13px;padding:8px 12px}.conversation-dialog> .conversation-actions>button:first-child{background:#2563eb;border-color:#2563eb}.conversation-dialog summary{cursor:pointer;padding:6px 0;color:#a7bad2}.conversation-dialog details .conversation-actions{margin-top:8px}.conversation-dialog header strong{font-size:15px;min-width:170px}.conversation-dialog header label{white-space:nowrap;font-size:13px}.conversation-task[data-focus=true]{border-color:#6cb7ff}'; document.head.append(style);
    const bar = el('div'); bar.className = 'conversation-bar'; bar.hidden=true; api.host.prepend(bar);
    const mode = el('select', '', bar); mode.setAttribute('aria-label', 'Uso do microfone');
    [['session','Voz nesta sessão'],['conversation','Conversar com Jarvis'],['dictation','Ditado · preencher texto']].forEach(([v,t]) => { const o = el('option',t,mode); o.value=v; });
    const health = el('small','Verificando voz…',bar); health.setAttribute('role','status');
    const panel = el('dialog','',document.body); panel.className='conversation-dialog'; panel.setAttribute('aria-label','Conversar com Jarvis e acompanhar tarefas');
    const hd=el('header','',panel);Object.assign(hd.style,{position:'sticky',top:'-20px',background:'var(--bg,#161b24)',zIndex:'2'}); el('strong','Conversar com Jarvis',hd); button('Fechar',hd,()=>panel.close());
    const topic=el('p','Nenhuma tarefa selecionada.',panel);
    const log=el('div','',panel); log.className='conversation-log'; log.setAttribute('role','log'); log.setAttribute('aria-live','polite');
    const input=el('textarea','',panel); input.placeholder='Converse, peça um status ou descreva uma nova tarefa.'; input.setAttribute('aria-label','Mensagem para o Jarvis'); input.maxLength=20000;
    const actions=el('div','',panel); actions.className='conversation-actions';
    const extra=el('details','',panel);el('summary','Correção e encerramento',extra);const extraActions=el('div','',extra);extraActions.className='conversation-actions';
    const pending=new Map(); let tasks=[], preferences={seen:{}}, selected=null, connected=false;
    const note=el('p','',panel); note.setAttribute('role','status');
    function say(text,error){ const p=el('p',text,log); if(error) p.setAttribute('role','alert'); log.scrollTop=log.scrollHeight; }
    function request(text) {
      if(!text.trim()) return;
      const id='cv'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);
      const message={t:'conversation_request',msgId:id,text,sessionId:api.session(),runnerId:api.runner(),speak:api.speak()};
      pending.set(id,message);
      if(!api.tx(message)){ note.textContent='Sem conexão. O texto permanece aqui; será enviado quando a conexão voltar nesta janela.'; return; }
      input.value=''; say('Você: '+text); note.textContent='Enviando pedido…';
    }
    button('Conversar',actions,()=>request(input.value));
    button('Criar tarefa',actions,()=>{if(input.value.trim())request('Nova tarefa: '+input.value);});
    button('Corrigir tarefa selecionada',extraActions,()=>{ if(!selected){note.textContent='Selecione uma tarefa primeiro.';return;} if(input.value.trim())request('Correção: '+input.value); });
    button('Falar',actions,()=>{mode.value='conversation';api.record();});
    button('Parar áudio',actions,()=>{api.stop();request('Pare de falar');});
    button('Cancelar tarefa selecionada',extraActions,()=>{if(!selected){note.textContent='Selecione uma tarefa primeiro.';return;} request('Cancele esta tarefa');});
    button('Encerrar conversa',extraActions,()=>{api.stop();request('Encerre a conversa');});
    input.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();request(input.value);}});
    const inboxHeader=el('header','',panel); el('strong','Tarefas e resultados',inboxHeader);
    button('Resumo ao voltar',inboxHeader,()=>request('Voltei'));
    const quietLabel=el('label','',inboxHeader),quiet=el('input','',quietLabel);quiet.type='checkbox';quietLabel.append(' Não interromper');quiet.onchange=()=>api.tx({t:'conversation_preferences',quiet:quiet.checked});
    const list=el('div','',panel);
    const stateLabels={queued:'Na fila',accepted:'Registrado',dispatched:'Encaminhado',running:'Em andamento',waiting_input:'Aguardando você',succeeded:'Concluído',failed:'Falhou',cancelled:'Cancelado',interrupted:'Interrompido — revisar',orphaned:'Interrompido',unknown:'Estado não confirmado',handled:'Respondido',transcription_failed:'Fala preservada — transcrição pendente'};
    function render(){
      selected=tasks.find(t=>preferences.task&&t.runnerId===preferences.task.runnerId&&t.sessionId===preferences.task.sessionId&&(!preferences.task.turnId||t.turnId===preferences.task.turnId));
      topic.textContent=selected?'Tarefa em foco: '+selected.title+' · '+(stateLabels[selected.state]||selected.state):'Conversa livre. Selecione uma tarefa para consultar, corrigir ou cancelar.';
      quiet.checked=!!preferences.quiet; list.replaceChildren();
      const visible=tasks.filter(t=>t.state!=='handled');
      if(!visible.length)el('p','Nenhuma tarefa registrada. Você pode criar uma acima.',list);
      visible.forEach(task=>{
        const card=el('article','',list);card.className='conversation-task';card.dataset.focus=String(selected?.id===task.id);
        el('strong',task.title,card);el('small',(stateLabels[task.state]||task.state)+' · '+new Date(task.updatedAt).toLocaleString(),card);el('small','Origem: '+task.origin+' · '+task.runnerId,card);
        if(task.summary)el('p',task.summary,card);
        if(task.state==='interrupted')el('p','A execução não foi confirmada após a queda. Revise o histórico antes de criar um novo pedido.',card);
        const row=el('div','',card);row.className='conversation-actions';
        if(task.voiceId)button('Tentar transcrever novamente',row,()=>{api.open(task.sessionId,task.runnerId);api.tx({t:'voice_retry',vtid:task.voiceId});});
        button('Selecionar',row,()=>api.tx({t:'conversation_preferences',taskId:task.id}));
        button(task.needsInput?'Revisar decisão e histórico':'Abrir histórico e arquivos',row,()=>{api.tx({t:'conversation_preferences',seenId:task.id});panel.close();api.open(task.sessionId,task.runnerId);});
        button('Guardar decisão / responsabilidade',row,()=>memory(task));
      });
    }
    function memory(task){
      const d=el('dialog','',document.body);d.className='conversation-dialog';d.setAttribute('aria-label','Guardar informação com origem');el('strong','Guardar com a fonte: '+task.title,d);
      const kind=el('select','',d);kind.setAttribute('aria-label','Tipo de informação');[['decision','Decisão'],['responsibility','Responsabilidade']].forEach(([v,t])=>{const o=el('option',t,kind);o.value=v;});
      const value=el('textarea','',d);value.maxLength=500;value.setAttribute('aria-label','Decisão ou responsabilidade');el('p','Guardar novamente o mesmo tipo nesta tarefa corrige a anotação anterior. Você pode revisar e excluir em Contexto pessoal.',d);
      button('Guardar',d,()=>{if(!value.value.trim())return;api.tx({t:'conversation_memory',taskId:task.id,kind:kind.value,value:value.value});d.close();});button('Cancelar',d,()=>d.close());d.onclose=()=>d.remove();d.showModal();value.focus();
    }
    let historySession,historyRunner;
    button('Histórico completo da conversa',inboxHeader,()=>{if(historySession){panel.close();api.open(historySession,historyRunner);}});
    function open(){ mode.value='conversation';if(!panel.open)panel.showModal();api.tx({t:'conversation_list',history:true});input.focus(); }
    button('Conversa e resultados',bar,open);button('Diagnóstico de voz',bar,()=>api.settings());
    function poll(){if(document.hidden)return;connected=api.online();health.textContent=connected?'Conectado · '+(health.dataset.audio||'voz sob demanda'):'Hub desconectado · aguardando reconexão';if(connected){api.tx({t:'conversation_list'});for(const m of pending.values()){if(m.runnerId===api.runner())api.tx(m);else note.textContent='Há um pedido ainda não confirmado em outra máquina. Volte à máquina de origem para reenviar.';}}}
    const timer=setInterval(poll,10000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
    return { mode:()=>mode.value, open,
      handle(m){
        if(m.t==='authed'||m.t==='version'){api.tx({t:'conversation_list'});}
        if(m.t==='wake_state'){const s=m.listener||{};health.dataset.audio=(s.connected?'Listener conectado':'Listener desconectado')+' · mic '+(s.mic||'desconhecido')+(s.output?.error?' · saída com erro':'')+(s.delivery?.error?' · armazenamento com erro: '+s.delivery.error:'')+(s.delivery?.pending?' · '+s.delivery.pending+' envio(s) pendente(s)':'');health.textContent=health.dataset.audio;return false;}
        if(m.t==='voice_dictation'){api.dictate(m.text,m.sessionId,m.runnerId);return true;}
        if(m.t==='conversation_ack'){pending.delete(m.requestId);note.textContent='Pedido registrado.';return true;}
        if(m.t==='conversation_busy'){note.textContent=m.message;return true;}
        if(m.t==='conversation_reply'){pending.delete(m.requestId);say('Jarvis: '+m.text,m.error);note.textContent=m.error?'Pedido precisa de atenção.':'Resposta disponível.';return true;}
        if(m.t==='conversation_stopped'){api.stop();if(m.ended){mode.value='dictation';note.textContent='Conversa encerrada. As tarefas continuam.';}return true;}
        if(m.t==='conversation_memory_result'){note.textContent=m.message;return true;}
        if(m.t==='conversation_inbox'){bar.hidden=false;tasks=m.tasks||[];preferences=m.preferences||{seen:{}};if(Array.isArray(m.history)){historySession=m.historySession;historyRunner=m.historyRunner;log.replaceChildren();for(const item of m.history)say((item.role==='user'?'Você: ':'Jarvis: ')+item.text);}render();if(m.updates?.length&&!preferences.quiet)api.notify(m.updates.length+' atualização(ões) em Tarefas e resultados.',open);return true;}
        return false;
      }
    };
  };
  root.installJarvisVoiceDiagnostics = function(api){
    const panel=document.querySelector('[data-panel="voz"]');if(!panel)return;
    const el=(tag,text,parent)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(parent)parent.append(n);return n;};
    const box=el('section');panel.prepend(box);el('h3','Teste sua voz',box);
    el('p','1. Escolha o microfone. 2. Fale por dois segundos. 3. Teste a saída. Os seletores deste aparelho não alteram o listener do PC.',box);
    const status=el('p','A captura só começa quando você tocar em Testar microfone.',box);status.setAttribute('role','status');
    const inputLabel=el('label','Microfone deste aparelho',box),input=el('select','',inputLabel);input.setAttribute('aria-label','Microfone deste aparelho');
    const outputLabel=el('label','Saída deste aparelho',box),output=el('select','',outputLabel);output.setAttribute('aria-label','Saída deste aparelho');
    const fill=(select,devices,selected)=>{select.replaceChildren();const def=el('option','Padrão do sistema',select);def.value='';for(const d of devices){const o=el('option',d.label||d.name||'Dispositivo sem nome',select);o.value=d.deviceId||d.name;}select.value=selected||'';};
    async function refresh(){try{const ds=await navigator.mediaDevices.enumerateDevices();fill(input,ds.filter(d=>d.kind==='audioinput'),api.cfg.inputDevice);fill(output,ds.filter(d=>d.kind==='audiooutput'),api.cfg.outputDevice);output.disabled=typeof HTMLMediaElement.prototype.setSinkId!=='function';if(output.disabled)output.title='Este navegador usa a saída escolhida nas configurações do sistema.';}catch(e){status.textContent='Não consegui listar os dispositivos: '+e.message;}}
    input.onchange=()=>{api.cfg.inputDevice=input.value;api.save();};output.onchange=()=>{api.cfg.outputDevice=output.value;api.save();};
    const mic=el('button','Testar microfone por 2 segundos',box);mic.type='button';
    mic.onclick=async()=>{let stream,context,timer,paused=false;mic.disabled=true;try{paused=await api.pause();stream=await navigator.mediaDevices.getUserMedia({audio:api.cfg.inputDevice?{deviceId:{exact:api.cfg.inputDevice}}:true});context=new AudioContext();await context.resume();const source=context.createMediaStreamSource(stream),an=context.createAnalyser();source.connect(an);const values=new Uint8Array(an.fftSize);let peak=0;status.textContent='Fale agora…';timer=setInterval(()=>{an.getByteTimeDomainData(values);for(const v of values)peak=Math.max(peak,Math.abs(v-128));status.textContent='Entrada recebida: '+Math.round(peak/128*100)+'% de pico';},100);await new Promise(r=>setTimeout(r,2000));status.textContent=peak>2?'Microfone recebeu sinal. Agora teste se a resposta sai pelo dispositivo certo.':'Microfone abriu, mas não recebi sinal. Verifique mudo, volume e permissão.';await refresh();}catch(e){status.textContent='Microfone indisponível: '+e.message;}finally{clearInterval(timer);stream?.getTracks().forEach(t=>t.stop());await context?.close();api.resume(paused);mic.disabled=false;}};
    const play=el('button','Testar saída',box);play.type='button';play.onclick=()=>{api.preview();status.textContent='Teste solicitado ao Hub. Confirme se ouviu; se não ouviu, confira conexão, volume e dispositivo de saída.';};
    const advanced=el('details','',panel);el('summary','Avançado · modelos, fim de fala e armazenamento',advanced);
    const ids=['setVoiceAgent','setVoiceModel','setVoiceEffort','setVoiceFastMode','setVoiceEscalate','setVoiceGateLevel','setContinueSec','setSilenceSec','setSmartEnd','setAudioDays','setAudioHubMb','setAudioDeviceMb'];
    for(const id of ids){const node=document.getElementById(id)?.closest('label');if(node)advanced.append(node);}
    const catalog=document.getElementById('voiceCatalog');if(catalog){const detail=el('details');el('summary','Escolher timbre da voz',detail);catalog.before(detail);detail.append(catalog);}
    const listener=el('details','',box);el('summary','Dispositivos do Hey Jarvis no PC',listener);const nativeIn=el('select','',listener),nativeOut=el('select','',listener);nativeIn.setAttribute('aria-label','Microfone do listener');nativeOut.setAttribute('aria-label','Saída do listener');
    const save=el('button','Aplicar no listener',listener);save.type='button';save.onclick=()=>{api.tx({t:'set_wake_devices',input:nativeIn.value,output:nativeOut.value});};
    const retry=el('button','Reenviar falas que falharam neste listener',listener);retry.type='button';retry.hidden=true;retry.onclick=()=>{api.tx({t:'wake_retry_delivery'});status.textContent='Nova tentativa solicitada para as falas preservadas no listener.';};
    let chosen={};
    navigator.mediaDevices?.addEventListener?.('devicechange',refresh);void refresh();
    return {handle(m){if(m.t==='voice_cfg'){chosen=m.cfg?.devices||{};}if(m.t==='wake_state'){const ds=m.listener?.devices||[];fill(nativeIn,ds.filter(d=>d.input),chosen.input);fill(nativeOut,ds.filter(d=>d.output),chosen.output);save.disabled=!m.listener?.connected;retry.hidden=!m.listener?.delivery?.failed;retry.disabled=!m.listener?.connected;}}};
  };
})(globalThis);
