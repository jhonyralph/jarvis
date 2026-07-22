    // Register the service worker on every load (not just when push is enabled) so the app shell is
    // cached and opens OFFLINE — a dropped Tailscale link no longer yields a blank page. Caching is
    // network-first for the HTML, so an online reload still deploys the latest UI (see web/sw.js).
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const $ = (id) => document.getElementById(id);
    const E = ['log','dot','title','roBanner','offlineBar','agentBtn','agentName','cwdBtn','cwdName','modelBtn','modelName','effortBtn','effortName','usageBtn','usageName','pop','speak','recents','moreBtn','files',
      'newSess','searchBtn','digestBtn','workBtn','workBadge','workPanel','workClose','workBack','workMax','workLive','workTree','workMachine','workSession','workAgent','workCrumb','workNodeTitle','workNodeState','workDetailBody','workMore','workNew','workAnnounce','fleetBtn','fleetModal','fleetBody','fleetClose','canvasModal','canvasTitle','canvasBody','canvasClose','sumHdr','tabRec','tabFiles','recPane','filesPane','recCnt','filesCnt','filesMore','qrBtn','qrModal','qrImg','qrUrl','qrClose','searchModal','searchInput','searchResults','searchGo','searchClose','smLiteral','smSemantic','semanticScope','memScopeProject','memScopeAll','memReindex','memoryModal','memoryTarget','memoryNote','memoryMeta','memoryCancel','memoryApply','settingsBtn','settings','setLang','setAgent','setModel','setEffort','setVoice','setContinue','setContinueSec','setVoiceAgent','setVoiceModel','setVoiceEffort','setVoiceEscalate','setVoiceRelevance',
      'setWake','setNoise','setPush','setBioLock','setGate','setSlash','policySettings','policyNote','setPolicyMode','setPolicyMemoryTarget','setPolicyRisk','setPolicyUnknown','setPolicyCost','setPolicyTokens','setPolicyRepoWrites','setPolicyDiff','setPolicyAutoplay','setPolicyBackground','setPolicyProject','setPolicySession','setPolicyOverrides','pushCfg','pushDone','pushError','pushMachine','pushMode','pushEvery','pushEveryRow','routinesSection','routinesList','rtName','rtPrompt','rtRunner','rtAgent','rtModel','rtEffort','rtCwd','rtBrowse','rtCron','rtCronHelp','rtCronExamples','rtSpeak','rtAdd','spkList','setEnroll','executionSettings','setExecEnabled','setExecRetention','setExecMaxEvents','setExecConcurrency','setExecDepth','setExecDefaultWrite','setExecWorktree','execCfgNote','setCancel','setClose','composer','input','cmdPop','mic','micCancel','attach','file','attachRow','queueRow','scrollBtn','usage','limit','sendBtn','stopBtn',
      'secBtn','secModal','secRole','secTtl','secGen','secOut','secInvites','secDevices','secRevokeAll','secClose',
      'secRunLabel','secRunGen','secRunOut','secRunners',
      'secPassStatus','secPass','secPassRemember','secPassSet','secPassClear','machineBar',
      'setSumAgent','setSumModel','setSumEffort','updStatus','updActions','updAll','updApply','updCheck','updMachines',
      'filePanel','fileName','fileMeta','fileBody','fileStat','fileView','fileCopy','fileClose','nativeChip',
      'imgModal','imgModalPic','imgClose','fileModal','fileModalName','fileModalBody','fileModalClose',
      'dlg','dlgTitle','dlgInput','dlgOk','dlgCancel','menuBtn','side','sideClose','backdrop','status'].reduce((o,k)=>(o[k]=$(k),o),{});
    // hidden file input (created dynamically)
    E.file = document.createElement('input'); E.file.type='file'; E.file.multiple=true; E.file.style.display='none'; document.body.appendChild(E.file);
    // visualizador de imagem (modal) — clicar em qualquer imagem (mensagem, preview do anexo,
    // miniatura da fila) abre aqui; fecha no ✕, no fundo ou com Esc. Nunca abre nova guia.
    function openImg(src){ if(!src)return; E.imgModalPic.src=src; E.imgModal.classList.remove('hidden'); }
    function closeImg(){ E.imgModal.classList.add('hidden'); E.imgModalPic.removeAttribute('src'); }
    E.imgModal.onclick=(e)=>{ if(e.target===E.imgModal||e.target===E.imgClose) closeImg(); };
    document.addEventListener('keydown',(e)=>{ if(e.key==='Escape'&&!E.imgModal.classList.contains('hidden')){ e.stopPropagation(); closeImg(); } });
    // visualizador de arquivo anexado (não-imagem) — clicar no chip "📎 nome" abre o conteúdo aqui
    // (o mesmo destaque de sintaxe do painel de arquivos). Sem conteúdo (cap de 256KB) → não abre.
    function openAttachedFile(f){ if(!f||f.content==null)return;
      E.fileModalName.textContent=f.name||'arquivo';
      const hl=highlight(f.content||'',f.name); if(hl!=null){ E.fileModalBody.innerHTML=hl; } else E.fileModalBody.textContent=f.content||'';
      E.fileModal.classList.remove('hidden'); }
    function closeFileModal(){ E.fileModal.classList.add('hidden'); E.fileModalBody.innerHTML=''; }
    E.fileModal.onclick=(e)=>{ if(e.target===E.fileModal) closeFileModal(); };
    E.fileModalClose.onclick=closeFileModal;
    document.addEventListener('keydown',(e)=>{ if(e.key==='Escape'&&!E.fileModal.classList.contains('hidden')){ e.stopPropagation(); closeFileModal(); } });

    let ws, currentSession=null, currentSessionRunner='local', currentAgent=null, caps=[], sessions=[], shown=16, filesShown=12, attachments=[], attachmentsBySession={}, browsePath='', browseRunner='local', browseUse=null, recentDirs=[], curNative=false, curNativeWritable=false, curNativeId='', creatingSession=false;
    let machines=[], currentMachine=localStorage.getItem('jarvis_machine')||'local', routedMachine='local', lastByMachine={}, restoringMachine=(currentMachine!=='local'&&currentMachine!=='all');
    // vista "Todas as máquinas": currentMachine==='all' é a VISÃO unificada; routedMachine é a máquina
    // real para onde o hub roteia (definida ao abrir/criar uma sessão da lista agregada). hue por nome.
    function machineHue(s){ let h=0; s=String(s||''); for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return h%360; }
    let allRefreshT=null; function scheduleAllRefresh(){ if(currentMachine!=='all')return; clearTimeout(allRefreshT); allRefreshT=setTimeout(()=>{ if(currentMachine==='all') tx({t:'listAll'}); }, 1500); }
    const isNative = id => typeof id==='string' && (id.startsWith('claude:')||id.startsWith('codex:'));
    const agentIcon = a => ({'claude-code':'🟣',codex:'🟢',gemini:'🔵',cursor:'⚫',copilot:'🟪',opencode:'🟠',cline:'🔴',qwen:'🔷',continue:'🟡',kiro:'🟤',antigravity:'🛸',aider:'🔹',mock:'⚪'})[a]||'🔹';
    let activeRuns=[]; const activeRunsByRunner={}; const unread=new Set(); // painel "rodando agora / precisa de você"
    const askingSids=new Set();  // machine+session keys still being analyzed for optional HITL
    // ---- config (persisted; refresh não perde estado) ----
    const cfg = Object.assign({ voice:false, continue:false, continueSec:30, wake:false, noise:true, voiceGate:false, push:false, pushEvents:['done','error'], pushMode:'each', pushEvery:15, lastCwd:'', tab:'rec' }, JSON.parse(localStorage.getItem('jarvis')||'{}'));
    const saveCfg = () => localStorage.setItem('jarvis', JSON.stringify(cfg));
    let speak = cfg.voice, speakers = [];
    // ---------- i18n (pt-BR / en / es) — fundação: a chrome sempre-visível é traduzida via data-i18n;
    //            o restante cai no pt (fallback). Novos textos: adicione a chave nos 3 idiomas + data-i18n. ----------
    const I18N={
      pt:{ newSession:'＋ Nova sessão', searchSessions:'buscar entre sessões', whatsUp:'o que está rolando', works:'Trabalhos', fleet:'Uso & custo', openMobile:'abrir no celular', devices:'dispositivos & convites', showMore:'Mostrar mais', settings:'⚙ Configurações', composerPh:'Fale ou digite…', secUpdate:'Atualização', secDefaults:'Padrões', secVoice:'Voz', secNotif:'Notificações', language:'Idioma', spSpeaking:'Jarvis falando…', spListening:'escutando…', spListeningAns:'escutando resposta…', spRefining:'Refinando…', spStopping:'parando…', spThinking:'Jarvis ouvindo…', machineOffline:'offline — as mensagens não serão entregues até ela voltar.', tFillOther:'Preencha o campo "Outros".', tPickOne:'Escolha uma opção ou marque "Outros".', tDelNoResp:'Sem resposta do servidor — a conversa NÃO foi removida.', tOpenFirst:'Abra uma conversa primeiro.', tPassShort:'Senha muito curta (mín. 8).', tPushUnsup:'Notificações não suportadas neste navegador.', tPushDenied:'Permissão de notificação negada.', tPushNoKey:'Servidor sem chave de push.', tMemReindexing:'Reindexando a memória semântica…', tRtFill:'Preencha o nome e o que rodar.', tFolderCopied:'Pasta copiada ✓', tDelFail:'Não consegui remover a conversa (talvez já não exista).', tShareIn:'Conteúdo compartilhado adicionado.', stAsking:'Jarvis perguntando…', stListeningAns:'Escutando resposta…', stSummarizing:'Gerando resumo…', stAnalyzing:'Analisando sessões…', lblAgent:'Agente padrão', lblModel:'Modelo padrão', lblEffort:'Esforço padrão', lblSlash:'Autocomplete de comandos ao digitar "/"', lblSpeakDefault:'Falar as respostas por padrão', lblContinue:'Após responder, continuar escutando follow-up', lblContinueWin:'Janela de escuta de continuação (segundos)', lblVoiceEscalate:'Refino por voz — modelo em análises difíceis', secAdvListen:'Escuta avançada', lblWake:'Wake word "Hey Jarvis" (na máquina)', lblNoise:'Filtro anti-ruído / detecção de fala (VAD)', lblPushDevice:'Notificar neste aparelho (Web Push)', lblBioLock:'Bloquear com biometria (Face ID / digital)', lblNotifyAbout:'Avisar sobre — vale só para este aparelho:', lblPushDone:'Sessão concluída (qualquer máquina)', lblPushError:'Falhas / erros', lblPushMachine:'Máquina ficou offline', lblDelivery:'Entrega', optEach:'Na hora, a cada evento', optGrouped:'Agrupar e avisar de tempos em tempos', lblEveryMin:'A cada quantos minutos', secRoutines:'Rotinas agendadas', secAutoRoute:'Roteamento automático, resumos e status', descAutoRoute:'A IA, o modelo e o esforço abaixo analisam mensagens em modo Automático e também executam resumos e consultas de status. Roda sempre no servidor (Hub).', lblVoiceRelevance:'Só despachar falas que são comando (filtro anti-ruído)', tVoiceIgnored:'🎙️ Ignorei — não pareceu um comando.', tQueued:'📋 Adicionado à fila — roda quando o turno atual terminar.' },
      en:{ newSession:'＋ New session', searchSessions:'search across sessions', whatsUp:"what's going on", works:'Work', fleet:'Usage & cost', openMobile:'open on phone', devices:'devices & invites', showMore:'Show more', settings:'⚙ Settings', composerPh:'Speak or type…', secUpdate:'Update', secDefaults:'Defaults', secVoice:'Voice', secNotif:'Notifications', language:'Language', spSpeaking:'Jarvis speaking…', spListening:'listening…', spListeningAns:'listening for your answer…', spRefining:'Refining…', spStopping:'stopping…', spThinking:'Jarvis listening…', machineOffline:"is offline — messages won't be delivered until it's back.", tFillOther:'Fill in the "Other" field.', tPickOne:'Pick an option or check "Other".', tDelNoResp:'No response from the server — the conversation was NOT deleted.', tOpenFirst:'Open a conversation first.', tPassShort:'Password too short (min. 8).', tPushUnsup:'Notifications not supported in this browser.', tPushDenied:'Notification permission denied.', tPushNoKey:'Server has no push key.', tMemReindexing:'Reindexing semantic memory…', tRtFill:'Fill in the name and what to run.', tFolderCopied:'Folder copied ✓', tDelFail:"Couldn't delete the conversation (it may no longer exist).", tShareIn:'Shared content added.', stAsking:'Jarvis asking…', stListeningAns:'Listening for your answer…', stSummarizing:'Generating summary…', stAnalyzing:'Analyzing sessions…', lblAgent:'Default agent', lblModel:'Default model', lblEffort:'Default effort', lblSlash:'Command autocomplete when typing "/"', lblSpeakDefault:'Speak replies by default', lblContinue:'After replying, keep listening for a follow-up', lblContinueWin:'Follow-up listening window (seconds)', lblVoiceEscalate:'Voice refine — model for hard analysis', secAdvListen:'Advanced listening', lblWake:'Wake word "Hey Jarvis" (on the machine)', lblNoise:'Noise filter / voice activity detection (VAD)', lblPushDevice:'Notify on this device (Web Push)', lblBioLock:'Lock with biometrics (Face ID / fingerprint)', lblNotifyAbout:'Notify about — this device only:', lblPushDone:'Session done (any machine)', lblPushError:'Failures / errors', lblPushMachine:'A machine went offline', lblDelivery:'Delivery', optEach:'Immediately, each event', optGrouped:'Group and notify periodically', lblEveryMin:'Every how many minutes', secRoutines:'Scheduled routines', lblVoiceRelevance:'Only dispatch utterances that are commands (noise filter)', tVoiceIgnored:"🎙️ Ignored — didn't seem like a command.", tQueued:'📋 Queued — it will run when the current turn finishes.' },
      es:{ newSession:'＋ Nueva sesión', searchSessions:'buscar entre sesiones', whatsUp:'qué está pasando', works:'Trabajos', fleet:'Uso y costo', openMobile:'abrir en el móvil', devices:'dispositivos e invitaciones', showMore:'Mostrar más', settings:'⚙ Configuración', composerPh:'Habla o escribe…', secUpdate:'Actualización', secDefaults:'Predeterminados', secVoice:'Voz', secNotif:'Notificaciones', language:'Idioma', spSpeaking:'Jarvis hablando…', spListening:'escuchando…', spListeningAns:'escuchando tu respuesta…', spRefining:'Refinando…', spStopping:'deteniendo…', spThinking:'Jarvis escuchando…', machineOffline:'desconectada — los mensajes no se entregarán hasta que vuelva.', tFillOther:'Completa el campo "Otros".', tPickOne:'Elige una opción o marca "Otros".', tDelNoResp:'Sin respuesta del servidor — la conversación NO fue eliminada.', tOpenFirst:'Abre una conversación primero.', tPassShort:'Contraseña muy corta (mín. 8).', tPushUnsup:'Notificaciones no soportadas neste navegador.', tPushDenied:'Permiso de notificación denegado.', tPushNoKey:'El servidor no tiene clave push.', tMemReindexing:'Reindexando la memoria semántica…', tRtFill:'Completa el nombre y qué ejecutar.', tFolderCopied:'Carpeta copiada ✓', tDelFail:'No pude eliminar la conversación (quizá ya no exista).', tShareIn:'Contenido compartido añadido.', stAsking:'Jarvis preguntando…', stListeningAns:'Escuchando tu respuesta…', stSummarizing:'Generando resumen…', stAnalyzing:'Analizando sesiones…', lblAgent:'Agente predeterminado', lblModel:'Modelo predeterminado', lblEffort:'Esfuerzo predeterminado', lblSlash:'Autocompletado de comandos al escribir "/"', lblSpeakDefault:'Leer las respuestas por defecto', lblContinue:'Tras responder, seguir escuchando un seguimiento', lblContinueWin:'Ventana de escucha de seguimiento (segundos)', lblVoiceEscalate:'Refinamiento por voz — modelo para análisis difíciles', secAdvListen:'Escucha avanzada', lblWake:'Palabra de activación "Hey Jarvis" (en la máquina)', lblNoise:'Filtro de ruido / detección de voz (VAD)', lblPushDevice:'Notificar en este dispositivo (Web Push)', lblBioLock:'Bloquear con biometría (Face ID / huella)', lblNotifyAbout:'Avisar sobre — solo este dispositivo:', lblPushDone:'Sesión terminada (cualquier máquina)', lblPushError:'Fallos / errores', lblPushMachine:'Una máquina se desconectó', lblDelivery:'Entrega', optEach:'Al instante, cada evento', optGrouped:'Agrupar y avisar periódicamente', lblEveryMin:'Cada cuántos minutos', secRoutines:'Rutinas programadas', lblVoiceRelevance:'Solo despachar frases que son comando (filtro de ruido)', tVoiceIgnored:'🎙️ Ignoré — no pareció un comando.', tQueued:'📋 En cola — se ejecutará cuando termine el turno actual.' },
    };
    Object.assign(I18N.en,{secAutoRoute:'Automatic routing, summaries and status',descAutoRoute:'The AI, model and effort below analyze messages in Automatic mode and also run summaries and status checks. It always runs on the Hub.'});
    Object.assign(I18N.es,{secAutoRoute:'Enrutamiento automático, resúmenes y estado',descAutoRoute:'La IA, el modelo y el esfuerzo siguientes analizan mensajes en modo Automático y también ejecutan resúmenes y consultas de estado. Siempre se ejecuta en el Hub.'});
    I18N.es.tPushUnsup='Notificaciones no soportadas en este navegador.';
    I18N.pt.lblSlash='Autocomplete e sugestões ao digitar “/”, “@”, “#” e “!”';
    I18N.en.lblSlash='Autocomplete and suggestions when typing “/”, “@”, “#” and “!”';
    I18N.es.lblSlash='Autocompletado y sugerencias al escribir “/”, “@”, “#” y “!”';
    I18N.pt.secDefaults='Chat'; I18N.en.secDefaults='Chat'; I18N.es.secDefaults='Chat';
    let lang = cfg.lang || (navigator.language||'pt').slice(0,2); if(!I18N[lang]) lang='pt';
    const t = k => (I18N[lang]&&I18N[lang][k]) || I18N.pt[k] || k;
    function applyI18n(){ document.querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent=t(el.dataset.i18n); }); document.querySelectorAll('[data-i18n-ph]').forEach(el=>{ el.placeholder=t(el.dataset.i18nPh); }); }
    function setLang(l){ if(!I18N[l])return; lang=l; cfg.lang=l; saveCfg(); applyI18n(); if(typeof refreshComposer==='function') refreshComposer(); }
    applyI18n();

    // ---------- markdown ----------
    const esc = s => s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    function inl(s){ return s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g,(_,a,u)=>`<img alt="${a}" src="${u}">`)
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g,(_,t,u)=>`<a href="${u}" target="_blank" rel="noopener">${t}</a>`)
      .replace(/`([^`]+)`/g,'<code>$1</code>')
      .replace(/\*\*\*([^*]+)\*\*\*/g,'<strong><em>$1</em></strong>')
      .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g,'$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g,'<del>$1</del>'); }
    function tableHtml(rows){ const cells=r=>r.replace(/^\s*\|/,'').replace(/\|\s*$/,'').split('|').map(c=>inl(esc(c.trim())));
      const head=cells(rows[0]),body=rows.slice(2).map(cells); return `<table><thead><tr>${head.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`; }
    function md(text){ const codes=[]; text=text.replace(/```(\w*)\n?([\s\S]*?)```/g,(_,l,c)=>{codes.push(c);return ` C${codes.length-1} `;});
      const L=text.split(/\r?\n/); let h='',i=0,m; while(i<L.length){ const line=L[i];
        if(m=line.match(/^ C(\d+) $/)){ h+=`<pre><button type="button" class="copy ghost">copiar</button><code>${esc(codes[+m[1]])}</code></pre>`; i++; continue; }
        if(/\|/.test(line)&&i+1<L.length&&/^\s*\|?[\s:|-]+\|/.test(L[i+1])){ const r=[]; while(i<L.length&&/\|/.test(L[i])){r.push(L[i]);i++;} h+=tableHtml(r); continue; }
        if(m=line.match(/^\s*(#{1,6})\s+(.*)/)){ h+=`<h4>${inl(esc(m[2]))}</h4>`; i++; continue; }
        if(/^\s*>\s?/.test(line)){ h+=`<blockquote>${inl(esc(line.replace(/^\s*>\s?/,'')))}</blockquote>`; i++; continue; }
        if(/^\s*([-*_]\s*){3,}$/.test(line)){ h+='<hr>'; i++; continue; }
        if(/^\s*[-*+]\s+/.test(line)){ const it=[]; while(i<L.length&&/^\s*[-*+]\s+/.test(L[i])){it.push(inl(esc(L[i].replace(/^\s*[-*+]\s+/,''))).replace(/^\[([ xX])\]\s+/,(_,c)=>/x/i.test(c)?'☑ ':'☐ '));i++;} h+=`<ul>${it.map(x=>`<li>${x}</li>`).join('')}</ul>`; continue; }
        if(/^\s*\d+[.)]\s+/.test(line)){ const it=[]; while(i<L.length&&/^\s*\d+[.)]\s+/.test(L[i])){it.push(inl(esc(L[i].replace(/^\s*\d+[.)]\s+/,''))));i++;} h+=`<ol>${it.map(x=>`<li>${x}</li>`).join('')}</ol>`; continue; }
        if(line.trim()===''){ i++; continue; } h+=`<p>${inl(esc(line))}</p>`; i++; } return h; }
    // present-tense verb → past-tense, once the action has finished
    const pastVerb={Read:'Lido',Edit:'Editado',Write:'Criado',NotebookEdit:'Editado',MultiEdit:'Editado',Grep:'Buscado',Glob:'Listado',WebFetch:'Aberto',WebSearch:'Pesquisado',Bash:'Executado'};
    function pastify(name,summary){ const pv=pastVerb[name]; return pv?String(summary||'').replace(/^\S+/,pv):summary; }
    // A tool-activity block (icon + summary + optional +/- counts). File tools are clickable
    // → open the viewer/diff panel. done=true shows past tense ("Editado"); reused by streaming
    // (present tense while running, flipped on done) AND by rebuilt history (already done).
    function toolRowEl(name,summary,path,adds,dels,done,rows,detail,opts){
      const d=document.createElement('div'); d.className='strtool'; d.dataset.name=name||''; d.dataset.sum=summary||'';
      const isFile=/Edit$/.test(name||'')||name==='Write'||name==='Read'||name==='NotebookEdit';
      const head=document.createElement('div'); head.className='strtoolhead';
      head.innerHTML=`<span>${toolIcon(name)}</span><span class="ttl">${esc((done?pastify(name,summary):summary)||name||'')}</span>`;
      const ttl=head.querySelector('.ttl');
      // clicar no NOME → abre o arquivo (conteúdo)
      if(path&&isFile){ ttl.classList.add('clk'); ttl.title='Abrir '+path; ttl.onclick=(e)=>{ e.stopPropagation(); openFile(path,'read',opts); }; }
      // clicar na CONTAGEM → diff SÓ desta alteração, inline (fallback: painel do arquivo inteiro)
      if(adds||dels){ const c=document.createElement('span'); c.className='tcnt'; c.innerHTML=`<span class="fadd">+${adds||0}</span> <span class="fdel">-${dels||0}</span>`;
        if(rows&&rows.length){ c.classList.add('clk'); c.title='Ver o diff desta alteração'; c.onclick=(e)=>{ e.stopPropagation(); toggleInlineDiff(d,rows,adds,dels); }; }
        else if(path){ c.classList.add('clk'); c.title='Ver diff no painel'; c.onclick=(e)=>{ e.stopPropagation(); openFile(path,'edit',opts); }; }
        head.appendChild(c); }
      d.appendChild(head); if(name!=='Read')addExpand(d,(done?pastify(name,summary):summary)||'',detail); return d; }
    // Comando/ação longa: recolhe em 2 linhas e adiciona "expandir/recolher". Aplica-se tanto às
    // linhas de tool do stream quanto ao bloco de atividade ao vivo.
    function addExpand(block,text,detail){ const hasDetail=!!(detail&&detail.length);
      if(!hasDetail && (text||'').length<=90 && !/\n/.test(text||''))return;
      block.classList.add('clamp'); const head=block.querySelector('.strtoolhead');
      const b=document.createElement('button'); b.type='button'; b.className='xpand'; b.title='Expandir'; b.textContent='▸';
      // se veio o comando completo (detail), expandir revela ele num bloco monoespaçado; senão só
      // desfaz o recorte de 2 linhas do resumo.
      let det=null; if(hasDetail){ det=document.createElement('div'); det.className='tdetail hidden'; det.textContent=detail; block.appendChild(det); }
      b.onclick=(e)=>{ e.stopPropagation(); const ex=block.classList.toggle('expanded'); if(det) det.classList.toggle('hidden',!ex); b.textContent=ex?'▾':'▸'; b.title=ex?'Recolher':'Expandir'; };
      if(head) head.insertBefore(b,head.firstChild); else block.appendChild(b); }
    // expande/colapsa o diff da alteração DENTRO do próprio chat
    function toggleInlineDiff(block,rows,adds,dels){
      const ex=block.querySelector('.tdiff'); if(ex){ ex.remove(); return; }
      const w=document.createElement('div'); w.className='tdiff';
      (rows||[]).forEach(r=>{ const cls=r.t==='+'?'add':r.t==='-'?'del':r.t==='@'?'sec':'ctx'; const ln=document.createElement('span'); ln.className='dline '+cls; ln.textContent=r.s; w.appendChild(ln); });
      block.appendChild(w); w.scrollIntoView({block:'nearest'}); }
    // flip a live tool block to past tense when its turn finishes
    function setToolDone(block){ if(block.classList.contains('tdone'))return; const nm=block.dataset.name, ttl=block.querySelector('.ttl'); if(ttl&&nm) ttl.textContent=pastify(nm,block.dataset.sum); block.classList.add('tdone'); }
    // Flip the tools ALREADY placed in a container to past tense ("Editando"→"Editado") the moment the
    // NEXT action in that container starts — a finished action shouldn't sit in present tense for the
    // rest of a long turn (it used to flip only when the WHOLE turn ended). Direct children only, so a
    // sub-agent box's internals aren't touched from the top level.
    function flipDone(container){ if(container) container.querySelectorAll(':scope > .strtool[data-name]:not(.tdone)').forEach(setToolDone); }
    function contextManifestEl(manifest){
      if(!manifest||manifest.schemaVersion!==1)return null;
      const details=document.createElement('details'); details.className='context-manifest';
      const summary=document.createElement('summary'); summary.textContent='Contexto do turno'; details.appendChild(summary);
      const grid=document.createElement('div'); grid.className='context-grid';
      const row=(label,value)=>{ const b=document.createElement('b'),v=document.createElement('span'); b.textContent=label; v.textContent=String(value==null?'—':value); grid.append(b,v); };
      row('Máquina',manifest.runnerId); row('Agente',manifest.agent); row('Pasta',manifest.cwd);
      const continuity=manifest.continuity||{}; row('Continuidade',continuity.kind+(continuity.nativeSessionId?' · '+continuity.nativeSessionId:''));
      row('Histórico',String(continuity.historyMessages||0)+' mensagens · '+String(continuity.historyChars||0)+' caracteres');
      const prompt=manifest.prompt||{}; row('Prompt',String(prompt.agentChars||0)+' caracteres'+(prompt.transformed?' · transformado':' · sem transformação'));
      row('Memória semântica',manifest.semanticMemory&&manifest.semanticMemory.injected?'injetada':'não injetada');
      const files=(manifest.instructionFiles||[]).map(f=>f.path+' ['+String(f.sha256||'').slice(0,10)+']').join('\n'); row('Instruções candidatas',files||'nenhuma');
      details.appendChild(grid); return details;
    }
    function buildMsgEl(m){
      if(m.role==='tool') return toolRowEl(m.name,m.text,m.path,m.adds,m.dels,true,m.rows,m.detail);
      const d=document.createElement('div'); if(m.role==='user'){ d.className='msg me';
        if(m.speaker){ const s=document.createElement('span'); s.textContent='🗣 '+m.speaker; s.style.cssText='display:block;font-size:11px;opacity:.7;margin-bottom:2px'; d.appendChild(s); }
        if(m.images&&m.images.length){ const w=document.createElement('div'); w.className='msgimgs'; m.images.forEach(u=>{ const im=document.createElement('img'); im.className='msgimg'; im.src=u; im.loading='lazy'; im.onclick=()=>openImg(u); w.appendChild(im); }); d.appendChild(w); }
        if(m.files&&m.files.length){ const w=document.createElement('div'); w.className='msgfiles'; m.files.forEach(f=>{ const c=document.createElement('button'); c.type='button'; c.className='filechip'+(f.content==null?' nocontent':''); c.title=f.content==null?'Anexo grande demais para reabrir':'Abrir '+f.name; c.textContent='📎 '+f.name; c.onclick=()=>openAttachedFile(f); w.appendChild(c); }); d.appendChild(w); }
        const showTxt=m.text&&!((m.images&&m.images.length||m.files&&m.files.length)&&m.text==='(anexo)'); if(showTxt) d.appendChild(document.createTextNode(m.text)); const context=contextManifestEl(m.contextManifest); if(context)d.appendChild(context); }
      else { d.className='msg bot';
        const af=(m.activity&&m.activity.length)?renderActivityBlock(m.activity):null;
        if(af) d.appendChild(af);
        // Se o histórico já tem os blocos text_delta/text_block dentro de activity, renderiza esses
        // textos intercalados no fluxo e NÃO duplica a resposta final no fim. Adapters que só
        // publicam texto final continuam caindo aqui.
        if(!(af&&af.dataset.rootText==='1')){
          const tx=document.createElement('div'); tx.innerHTML=md(m.text); d.appendChild(tx);
        } } return d; }
    // Réplica ESTÁTICA (histórico) do que streamTool/streamText/ensureSubAgent fazem AO VIVO — mesma
    // estrutura visual (caixas de subagente com contagem, linhas de ferramenta), mas com estado local
    // (não usa strFlow/subAgents globais). Quando o histórico carrega text_delta/text_block,
    // renderiza o texto de nível raiz INTERCALADO no fluxo; quando o adapter só salvou texto final,
    // buildMsgEl ainda mostra m.text ao fim como fallback.
    function readToolKey(name,path,summary,detail,parentId){
      if(name!=='Read')return '';
      const raw=String(path||summary||detail||'').replace(/\\/g,'/').replace(/\s+/g,' ').trim();
      if(!raw)return '';
      const target=raw
        .replace(/\s*\((?:offset|limit|line|lines|linha|linhas|bytes|chunk|parte)[^)]*\)/gi,'')
        .replace(/\b(?:offset|limit|line|lines|linha|linhas|bytes|chunk|parte)\s*[:=]?\s*\d+\b/gi,'')
        .trim().toLowerCase();
      return target?'read\0'+(parentId||'root')+'\0'+target:'';
    }
    function normalizeActivity(events){ const out=[], tools={};
      const addTool=t=>{ const callKey=t.toolId?(t.parentId||'root')+'\0'+t.toolId:''; const readKey=readToolKey(t.name,t.path,t.summary,t.detail,t.parentId); const key=readKey||callKey,old=key&&tools[key]; if(old)Object.assign(old,t);else{if(key)tools[key]=t;out.push(t);} };
      (events||[]).forEach(ev=>{ if(ev&&ev.schemaVersion===1){
          if(ev.kind==='text_delta'||ev.kind==='text_block') out.push({kind:'text',text:ev.text||'',parentId:ev.parentId||(ev.tool&&ev.tool.parentId),executionId:ev.executionId});
          else if(ev.kind==='thinking') out.push({kind:'thinking',text:ev.text,parentId:ev.parentId,executionId:ev.executionId});
          else if(/^tool_/.test(ev.kind)&&ev.tool) addTool({kind:'tool',name:ev.tool.name,summary:ev.tool.summary,detail:ev.tool.detail,path:ev.tool.path,adds:ev.tool.adds,dels:ev.tool.dels,rows:ev.tool.rows,toolId:ev.tool.callId,parentId:ev.tool.parentId,status:ev.tool.status,error:ev.tool.error,executionId:ev.executionId});
          else if(ev.kind==='plan') out.push({kind:'tool',name:'Plan',summary:ev.plan&&ev.plan.title||ev.text||'Plano atualizado',status:'completed',parentId:ev.parentId,executionId:ev.executionId});
        } else if(ev&&ev.kind==='tool') addTool({...ev}); else out.push(ev); }); return out; }
    function renderActivityBlock(events,opts){
      const flow=document.createElement('div'); flow.className='strflow acthist';
      const subAgents={}; let curTextEl=null, curTextRaw='', rootText=false;
      function closeTextBlock(){ curTextEl=null; curTextRaw=''; }
      function ensureSA(id,desc,executionId){ if(subAgents[id]){ if(desc)subAgents[id].title.textContent=desc; if(executionId)bindInlineWork(subAgents[id],executionId); return subAgents[id]; }
        const wrap=document.createElement('div'); wrap.className='subagent'; wrap.dataset.id=id;
        wrap.innerHTML='<div class="sahead"><span class="satog">▸</span><span>🤖</span><span class="satitle"></span><span class="sastate"></span><span class="sacount">0</span><button type="button" class="saopen" title="Abrir em Trabalhos">abrir</button></div><div class="sabody hidden"></div>';
        const head=wrap.querySelector('.sahead'), body=wrap.querySelector('.sabody'), title=wrap.querySelector('.satitle'), countEl=wrap.querySelector('.sacount'), tog=wrap.querySelector('.satog'), open=wrap.querySelector('.saopen');
        title.textContent=desc||'sub-agente';
        head.onclick=()=>{ const hid=body.classList.toggle('hidden'); tog.textContent=hid?'▸':'▾'; };
        closeTextBlock(); flow.appendChild(wrap);
        const rec={wrap,body,title,countEl,open,count:0,preview:null,previewText:''}; subAgents[id]=rec; if(executionId)bindInlineWork(rec,executionId); return rec; }
      normalizeActivity(events).forEach(ev=>{
        if(ev.kind==='tool'){
          if(ev.parentId){ const sa=ensureSA(ev.parentId,null,ev.executionId); sa.body.appendChild(toolRowEl(ev.name,ev.summary,ev.path,ev.adds,ev.dels,true,ev.rows,ev.detail,opts)); sa.count++; sa.countEl.textContent=sa.count; return; }
          if((ev.name==='Task'||ev.name==='Agent')&&ev.toolId){ ensureSA(ev.toolId,(ev.summary||'').replace(/^Subagente:\s*/,'')||'sub-agente',ev.executionId); return; }
          closeTextBlock(); flow.appendChild(toolRowEl(ev.name,ev.summary,ev.path,ev.adds,ev.dels,true,ev.rows,ev.detail,opts));
        } else if(ev.kind==='text'){
          const t=ev.text||''; if(!t)return;
          if(ev.parentId){
            const sa=ensureSA(ev.parentId,null,ev.executionId);
            if(!sa.preview){ sa.preview=document.createElement('div'); sa.preview.className='sapreview'; sa.body.appendChild(sa.preview); }
            sa.previewText+=t; sa.preview.textContent=sa.previewText.slice(-240);
          } else {
            if(!curTextEl){ flipDone(flow); curTextEl=document.createElement('div'); curTextEl.className='strtext done'; curTextRaw=''; flow.appendChild(curTextEl); }
            curTextRaw+=t; curTextEl.innerHTML=md(curTextRaw); rootText=true;
          }
        } else if(ev.kind==='thinking'){ if(ev.parentId){const sa=ensureSA(ev.parentId,null,ev.executionId);sa.body.appendChild(toolRowEl('Thinking',ev.text||'Pensando…',null,0,0,true,null,null,opts));sa.count++;sa.countEl.textContent=sa.count;}else{closeTextBlock();flow.appendChild(toolRowEl('Thinking',ev.text||'Pensando…',null,0,0,true,null,null,opts));} }
      });
      if(rootText) flow.dataset.rootText='1';
      return flow.childNodes.length?flow:null; }
    // Trocar de sessão custa DUAS travessias de rede quando ela vive em outra máquina
    // (browser → hub → runner → hub → browser), e esse enlace pode ser um relay: medido entre
    // Luby e o Desktop, o RTT oscila de 28ms a 621ms via DERP. O payload, porém, é o mesmo que
    // já desenhamos — então guardamos: revisitar pinta na hora e a cópia fresca só substitui
    // quando chega. Limitado a poucas sessões porque isso também roda no celular.
    function selectedRunner(){ return currentMachine==='all'?(routedMachine||'local'):(currentMachine||'local'); }
    function sessionStateKey(sid,runner){ return (runner||selectedRunner())+'\0'+(sid||''); }
    function sessionRunner(){ return currentSession?(currentSessionRunner||selectedRunner()):selectedRunner(); }
    function sessionValue(state,sid,runner){ return state[sessionStateKey(sid,runner)]; }
    const histCache=new Map(); const HIST_CACHE_MAX=12; let openingSession=null;
    function cacheHist(m){ if(!m||!m.sessionId)return; const key=sessionStateKey(m.sessionId,m.runnerId||selectedRunner()); histCache.delete(key); histCache.set(key,m);
      if(histCache.size>HIST_CACHE_MAX) histCache.delete(histCache.keys().next().value); }
    function dedupeSessionsList(list){
      const out=[], seen=new Set();
      (list||[]).forEach(s=>{ if(!s||!s.id)return; const key=(s.runnerId||'local')+'|'+s.id; if(seen.has(key))return; seen.add(key); out.push(s); });
      return out;
    }
    function rememberHistoryActivity(messages){
      let lastTurn=null;
      (messages||[]).forEach(m=>(m.activity||[]).forEach(ev=>{
        if(!ev||ev.schemaVersion!==1)return;
        if(ev.turnId)lastTurn=ev.turnId;
        if(ev.eventId)seenAgentEvents.add(ev.eventId);
      }));
      if(seenAgentEvents.size>1200){
        const keep=[...seenAgentEvents].slice(-1200);
        seenAgentEvents.clear(); keep.forEach(x=>seenAgentEvents.add(x));
      }
      if(lastTurn)liveTurnId=lastTurn;
    }
    function showSessionLoading(id,runnerId){
      const targetRunner=runnerId||selectedRunner(), prevSession=currentSession, prevRunner=currentSessionRunner, switchingSession=prevSession!==id||prevRunner!==targetRunner;
      if(switchingSession && prevSession!=null){ draftBySession[sessionStateKey(prevSession,prevRunner)]=E.input.value; saveDrafts(); stashAttachments(prevSession,prevRunner); }
      currentSession=id; currentSessionRunner=targetRunner; lastByMachine[currentMachine]=id; unread.delete(sessionStateKey(id,targetRunner)); updateOfflineBanner();
      const s=sessions.find(x=>x.id===id)||{};
      currentAgent=s.agent||availableMachineCaps()[0]?.name||caps[0]?.name; curCwd=s.cwd||''; curNative=!!s.native||isNative(id);
      curNativeWritable=false; curNativeId=''; curStarted=!!s.started; sessDeclModel=s.model||null; sessDeclEffort=s.effort||null; lastRouteReason='';
      E.title.textContent=s.title||'Carregando sessão...'; refreshTitleInfo(); syncModelEffort();
      clearPending(); streamErr(); seenAgentEvents.clear(); liveTurnId=null; E.log.innerHTML='';
      askActive=null; askVoice=false; askPendingVoice=false; updateStopStatus();
      const row=document.createElement('div'); row.className='msg bot pending sessionload';
      const work=document.createElement('span'); work.className='work';
      const spin=document.createElement('span'); spin.className='spin';
      const txt=document.createElement('span'); txt.textContent=busy(id)?'Reconstruindo atividade em andamento...':'Carregando histórico...';
      work.appendChild(spin); work.appendChild(txt); row.appendChild(work); E.log.appendChild(row); forceBottomSoon();
      curFiles=[]; renderFiles(); closeFilePanel(); renderRecents(); closePop();
      if(switchingSession){ E.input.value=sessionValue(draftBySession,id,targetRunner)||''; E.input.style.height='auto'; E.input.style.height=E.input.scrollHeight+'px'; restoreAttachments(id,targetRunner); }
      renderNativeChip(); setHash(currentSession); refreshComposer();
    }
    // Ponto único de troca de sessão: pinta do cache (se houver) e pede a versão fresca sempre —
    // o cache acelera, nunca decide o que é verdade.
    function openSession(id,runnerId){ if(!id)return;
      // visão unificada: a sessão carrega runnerId — troca a máquina roteada para a dona ANTES de abrir
      // (o hub processa as mensagens em ordem, então o open já cai na máquina certa).
      const listed=currentMachine==='all'&&sessions.find(x=>x.id===id&&(!runnerId||x.runnerId===runnerId)), rid=runnerId||(listed&&listed.runnerId)||selectedRunner();
      if(rid!==routedMachine){ routedMachine=rid; tx({t:'runner',runnerId:rid}); }
      const key=sessionStateKey(id,rid), same=id===currentSession&&rid===currentSessionRunner;
      openingSession=key; const c=histCache.get(key); if(c&&!same) applyHistory(c); else if(!c&&(!same||!E.log.childElementCount)) showSessionLoading(id,rid); tx({t:'open',sessionId:id}); }
    function applyHistory(m){
      // NÃO limpar a fila da sessão anterior — ela continua válida quando o turno dela terminar.
      // Rascunho do composer é POR SESSÃO: ao TROCAR de sessão guarda o texto não-enviado da anterior
      // e restaura o da nova; um refresh da MESMA sessão nunca mexe no que você está digitando agora.
      const targetRunner=m.runnerId||selectedRunner(), prevSession=currentSession, prevRunner=currentSessionRunner, switchingSession=prevSession!==m.sessionId||prevRunner!==targetRunner;
      if(switchingSession && prevSession!=null){ draftBySession[sessionStateKey(prevSession,prevRunner)]=E.input.value; saveDrafts(); stashAttachments(prevSession,prevRunner); }
      currentSession=m.sessionId; currentSessionRunner=targetRunner; lastByMachine[currentMachine]=m.sessionId; unread.delete(sessionStateKey(m.sessionId,targetRunner)); updateOfflineBanner();
      currentAgent=(m.session||{}).agent||availableMachineCaps()[0]?.name||caps[0]?.name; curCwd=(m.session||{}).cwd||''; curNative=!!(m.session||{}).native;
      sessDeclModel=(m.session||{}).model||null; sessDeclEffort=(m.session||{}).effort||null; lastRouteReason='';   // modelo/esforço reais da sessão da máquina (só nativas mandam)
      if(curCwd && !curNative){cfg.lastCwd=curCwd;saveCfg();} curStarted=(m.messages||[]).length>0;
      E.title.textContent=(m.session||{}).title||'Sessão'; refreshTitleInfo(); syncModelEffort(); clearPending(); streamErr(); seenAgentEvents.clear(); liveTurnId=null; E.log.innerHTML='';
      askActive=null; askVoice=false; askPendingVoice=false;   // troca de sessão encerra qualquer card/wizard de decisão
      updateStopStatus();   // reflete o "parando…" da sessão ATUAL (por sessão, não global)
      const msgs=m.messages||[], frag=document.createDocumentFragment(); // render em lote (1 reflow) — leve no mobile
      if(m.total&&m.total>msgs.length){ const n=document.createElement('div'); n.className='msg err'; n.textContent=`— mostrando as últimas ${msgs.length} de ${m.total} mensagens —`; frag.appendChild(n); }
      msgs.forEach(mm=>frag.appendChild(buildMsgEl(mm))); rememberHistoryActivity(msgs); E.log.appendChild(frag); if(busy(m.sessionId)) showPending(); forceBottomSoon();
      if(getRestorable(m.sessionId)){
        // Só é "não enviada" de verdade se a ÚLTIMA mensagem do histórico ainda for do usuário (sem
        // resposta). Se já tem resposta (ex.: o hub reconciliou com o transcript nativo depois de um
        // restart), a barra estava aparecendo à toa — limpa em vez de mostrar.
        const lastMsg=msgs[msgs.length-1];
        if(lastMsg && lastMsg.role==='assistant') clearRestorable(m.sessionId); else showRestoreBar(m.sessionId);
      }
      curFiles=(m.files||[]).slice(); filesShown=12; renderFiles(); closeFilePanel(); lastInputTokens=(m.session||{}).inputTokens||0; lastContextWindow=(m.session||{}).contextWindowTokens||0; sessCost=(m.session||{}).sessionCost||0; sessUsage=(m.session||{}).sessionUsage||null; updUsagePill(); renderRecents(); closePop();
      curNativeWritable=curNative&&!!(m.session||{}).writable; const ro=curNative&&!curNativeWritable;
      E.roBanner.classList.toggle('hidden',!curNative);
      E.roBanner.innerHTML = curNativeWritable ? '🔗 Sessão da máquina ('+esc(currentAgent||'')+') — você pode continuar por aqui' : '👁 Sessão nativa (somente leitura no Jarvis)';
      E.input.disabled=ro; E.sendBtn.disabled=ro; E.mic.disabled=ro; E.input.placeholder=ro?'Sessão nativa — somente leitura':'Fale ou digite…';
      if(switchingSession){ E.input.value=sessionValue(draftBySession,m.sessionId,targetRunner)||''; E.input.style.height='auto'; E.input.style.height=E.input.scrollHeight+'px'; restoreAttachments(m.sessionId,targetRunner); }
      curNativeId=(!curNative && (m.session||{}).nativeId) ? (m.session||{}).nativeId : ''; renderNativeChip(); setHash(currentSession);
      { const savedAsk=getAsk(m.sessionId,sessionRunner()); if(savedAsk&&savedAsk.length&&!askActive) renderAskCard(savedAsk,sessionRunner()); }   // restaura decision-card pendente (lock/reload)
      if(!stagingActive) tx({t:'stage_state',sessionId:m.sessionId});   // restaura painel de refino de voz, se houver (lock/reload)
      refreshComposer();
    }
    // Anchor: a user message must never land under an open reply bubble, even if the echo arrives
    // after the stream started (remote runners emit over the network, order isn't guaranteed).
    // ---- auto-scroll inteligente: gruda no fim só quando o usuário ESTÁ no fim. Se ele sobe além
    // de ~10% da altura, para de puxar; volta a grudar ao chegar de novo no fim. O botão flutuante
    // aparece quando há conteúdo abaixo e leva de volta às mensagens recentes.
    let stick=true;
    function distBottom(){ return E.log.scrollHeight - E.log.scrollTop - E.log.clientHeight; }
    function updScrollBtn(d){ if(d==null)d=distBottom(); if(E.scrollBtn) E.scrollBtn.classList.toggle('hidden', d<60); }
    function autoScroll(){ if(stick) E.log.scrollTop=E.log.scrollHeight; updScrollBtn(); }
    function forceBottom(){ stick=true; E.log.scrollTop=E.log.scrollHeight; updScrollBtn(0); }
    function forceBottomSoon(){ forceBottom(); requestAnimationFrame(()=>{ forceBottom(); requestAnimationFrame(forceBottom); }); setTimeout(forceBottom,100); }
    E.log.addEventListener('scroll',()=>{ const d=distBottom(); if(d<40) stick=true; else if(d>E.log.clientHeight*0.1) stick=false; updScrollBtn(d); });
    if(E.scrollBtn) E.scrollBtn.onclick=forceBottom;
    function addMsg(m){ const d=buildMsgEl(m); const anchor=pendingEl||(m.role==='user'?strEl:null); if(anchor) E.log.insertBefore(d,anchor); else E.log.appendChild(d); autoScroll(); }
    function note(t){ const d=document.createElement('div'); d.className='msg bot'; d.textContent=t; E.log.appendChild(d); autoScroll(); }
    // Stepper de decisão: perguntas (single/multi) + campo "Outros", com Voltar/Avançar. Ao concluir,
    // compõe as escolhas e envia como o PRÓXIMO input (o agente continua a partir daí). Agnóstico.
    let askActive=null, askVoice=false, askPendingVoice=false, ttsPlaying=false; // wizard de decisão (+voz)
    let stagingActive=false, curTtsAudio=null; // voz ambiente: refino por cima do agente + handle do TTS p/ interromper
    function stopTTS(){ try{ if(curTtsAudio){ curTtsAudio.pause(); curTtsAudio=null; } }catch(e){} ttsPlaying=false; }
    function renderAskCard(questions,runnerId){
      if(!Array.isArray(questions)||!questions.length) return;
      E.log.querySelectorAll('.askcard').forEach(c=>c.remove());  // idempotente: nunca empilha (resend no open)
      const answers=questions.map(()=>({sel:new Set(), other:'', otherSel:false}));
      const card=document.createElement('div'); card.className='msg bot askcard'; E.log.appendChild(card);
      const st={questions,answers,step:0,card,runnerId:runnerId||sessionRunner()};
      function draw(){ const q=questions[st.step], a=answers[st.step]; card.innerHTML=''; card.classList.toggle('min',!!st.min);
        const hd=document.createElement('div'); hd.className='askhd';
        const lbl=document.createElement('span'); lbl.textContent=`Passo ${st.step+1}/${questions.length}${q.header?' · '+q.header:''}`;
        const right=document.createElement('span'); right.style.cssText='display:flex;align-items:center;gap:8px';
        if(!st.min){ const hint=document.createElement('span'); hint.textContent=q.multi?'escolha uma ou mais':'escolha uma'; right.appendChild(hint); }
        const mini=document.createElement('button'); mini.type='button'; mini.className='askmin'; mini.textContent=st.min?'▸ abrir':'▾ minimizar'; mini.title=st.min?'Abrir a decisão':'Minimizar para ver o histórico'; mini.onclick=(e)=>{ e.stopPropagation(); st.min=!st.min; draw(); };
        right.appendChild(mini); hd.appendChild(lbl); hd.appendChild(right); card.appendChild(hd);
        const qt=document.createElement('div'); qt.className='askq'; qt.textContent=q.question; card.appendChild(qt);
        const opts=document.createElement('div'); opts.className='askopts';
        q.options.forEach((o,i)=>{ const b=document.createElement('button'); b.type='button'; b.className='askopt'+(a.sel.has(i)?' on':'');
          b.innerHTML=`<span class="l"><b class="onum">${i+1}.</b> ${esc(o.label)}</span>`+(o.desc?`<span class="d">${esc(o.desc)}</span>`:'');
          b.onclick=()=>{ if(q.multi){ a.sel.has(i)?a.sel.delete(i):a.sel.add(i); } else { a.sel.clear(); a.sel.add(i); a.otherSel=false; } draw(); };
          opts.appendChild(b); });
        // "Outros": em escolha única é uma opção; em múltipla, um check. Marcar abre o campo livre.
        const ob=document.createElement('button'); ob.type='button'; ob.className='askopt'+(a.otherSel?' on':'');
        ob.innerHTML=`<span class="l"><b class="onum">${q.options.length+1}.</b> ${q.multi?(a.otherSel?'☑ ':'☐ '):''}Outros…</span>`;
        ob.onclick=()=>{ if(q.multi){ a.otherSel=!a.otherSel; } else { a.sel.clear(); a.otherSel=true; } draw(); if(a.otherSel){ const inp=card.querySelector('.askother'); if(inp) inp.focus(); } };
        opts.appendChild(ob);
        card.appendChild(opts);
        if(a.otherSel){ const other=document.createElement('input'); other.type='text'; other.className='askother'; other.placeholder='Diga como deve ser…'; other.value=a.other;
          other.oninput=()=>{ a.other=other.value; }; card.appendChild(other); }
        const nav=document.createElement('div'); nav.className='asknav';
        const back=document.createElement('button'); back.type='button'; back.className='ghost'; back.textContent='◀ Voltar'; back.disabled=st.step===0; back.onclick=()=>go(-1);
        const sp=document.createElement('span'); sp.className='grow';
        const fwd=document.createElement('button'); fwd.type='button'; fwd.textContent=st.step===questions.length-1?'Enviar ✓':'Avançar ▶'; fwd.onclick=()=>go(1);
        nav.appendChild(back); nav.appendChild(sp); nav.appendChild(fwd); card.appendChild(nav);
        if(!st.min) autoScroll();
      }
      function go(dir){ const a=answers[st.step];
        if(dir>0){ if(a.otherSel && !a.other.trim()){ toast(t('tFillOther')); return; }
          if(!a.sel.size && !(a.otherSel && a.other.trim())){ toast(t('tPickOne')); return; } }
        const nx=st.step+dir; if(nx<0) return;
        if(nx>=questions.length){ submit(); return; }
        st.step=nx; draw();
      }
      function answerText(i){ const q=questions[i],a=answers[i]; const picks=[...a.sel].map(x=>q.options[x].label); if(a.otherSel && a.other.trim())picks.push('Outros: '+a.other.trim()); return picks.join('; '); }
      function submit(){ const text='Decisões escolhidas:\n'+questions.map((q,i)=>`- ${q.question}\n  → ${answerText(i)}`).join('\n');
        card.classList.add('done'); const nav=card.querySelector('.asknav'); if(nav)nav.remove(); const wasVoice=st.voice; askActive=null; askVoice=false; clearAsk(currentSession,st.runnerId); tx({t:'ask_clear',sessionId:currentSession});
        sendMsgTo(currentSession, text); if(wasVoice) lastWasVoice=true; }  // mantém o modo voz para a próxima decisão
      st.draw=draw; st.submit=submit; st.voice=lastWasVoice; askActive=st; draw(); refreshComposer();
      // Se a decisão veio de uma fala, conduz por VOZ (step a step). Espera a fala da resposta
      // terminar antes de começar, pra não sobrepor áudio.
      if(st.voice){ if(ttsPlaying) askPendingVoice=true; else startAskVoice(); }
    }
    // ---- wizard de VOZ dos cards de decisão ----
    function startAskVoice(){ if(!askActive)return; askVoice=true; askVoiceStep(); }
    function askVoiceStep(){ const st=askActive; if(!st||!askVoice)return; const q=st.questions[st.step];
      const spoken=`${q.question}. Opções: ${q.options.map((o,i)=>(i+1)+', '+o.label).join('; ')}. Ou diga outros. Diga voltar ou avançar para navegar.`;
      status('speaking',t('stAsking')); tx({t:'say',text:spoken,sessionId:currentSession}); }
    function playClip(b64){ return new Promise(res=>{ try{ const b=atob(b64),u=new Uint8Array(b.length); for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);
      const a=new Audio(URL.createObjectURL(new Blob([u],{type:'audio/wav'}))); a.onended=()=>res(); a.onerror=()=>res(); a.play().catch(()=>res()); }catch(e){ res(); } }); }
    async function askVoicePlayAndListen(b64){ status('speaking',t('stAsking')); await playClip(b64);
      if(!askVoice||!askActive)return; status('listening',t('stListeningAns')); let clip;
      try{ clip=await recordClip(Math.max(5,cfg.continueSec)*1000); }catch(e){ status(''); return; }
      const q=askActive.questions[askActive.step];
      tx({t:'ask_voice',audio:clip,ext:'webm',question:q.question,options:q.options,multi:q.multi,sessionId:currentSession}); }
    function askAdvance(){ const st=askActive; if(!st)return; if(st.step<st.questions.length-1){ st.step++; st.draw(); askVoiceStep(); } else { askVoice=false; st.submit(); } }
    function askVoiceApply(m){ const st=askActive; if(!st||!askVoice)return; const a=st.answers[st.step], q=st.questions[st.step];
      if(m.action==='back'){ if(st.step>0)st.step--; st.draw(); askVoiceStep(); return; }
      if(m.action==='repeat'){ askVoiceStep(); return; }
      if(m.action==='next'){ if(!a.sel.size && !a.other.trim()){ askVoiceStep(); return; } askAdvance(); return; }
      if(m.action==='choose' && Array.isArray(m.indices) && m.indices.length){ if(!q.multi)a.sel.clear(); m.indices.forEach(i=>{ if(i>=0&&i<q.options.length)a.sel.add(i); }); st.draw();
        if(q.multi){ status('speaking','…'); tx({t:'say',text:'Anotado. Diga mais opções, ou avançar.',sessionId:currentSession}); } else askAdvance(); return; }
      const other=(m.other||'').trim();
      if(other){ a.otherSel=true; a.other=(a.other?a.other+'; ':'')+other; st.draw(); if(q.multi){ status('speaking','…'); tx({t:'say',text:'Anotado. Diga mais, ou avançar.',sessionId:currentSession}); } else askAdvance(); }
      else askVoiceStep(); }
    // indicador AO VIVO com cronômetro — deixa claro que há algo executando
    let pendingEl=null, pendingTimer=null, pendingStart=0;
    function showPending(){ if(pendingEl)return; pendingStart=Date.now(); pendingEl=document.createElement('div'); pendingEl.className='msg bot pending';
      const upd=()=>{ if(!pendingEl)return; const s=Math.floor((Date.now()-pendingStart)/1000); const t=s>=60?`${Math.floor(s/60)}m ${s%60}s`:`${s}s`;
        pendingEl.innerHTML=`<span class="work"><span class="spin"></span>Jarvis trabalhando… ${t}</span>`; };
      upd(); pendingTimer=setInterval(upd,1000); E.log.appendChild(pendingEl); updateStopStatus(); autoScroll(); }
    function clearPending(){ if(pendingTimer){ clearInterval(pendingTimer); pendingTimer=null; } if(pendingEl){ pendingEl.remove(); pendingEl=null; } }
    // ---- streaming (atividade ao vivo: ferramentas + texto) ----
    const toolIcon = n => ({Bash:'🖥',Read:'📄',Edit:'✏️',Write:'✏️',NotebookEdit:'✏️',MultiEdit:'✏️',Grep:'🔎',Glob:'📁',Task:'🤖',Agent:'🤖',WebFetch:'🌐',WebSearch:'🌐',Thinking:'◔',Plan:'📋'}[n]||'🔧');
    // strFlow = container ordenado; curTextEl = bloco de texto aberto (null após uma ferramenta,
    // pra o próximo texto virar um bloco NOVO); curTextRaw = markdown acumulado desse bloco.
    let strEl=null, strFlow=null, curTextEl=null, curTextRaw='', sawText=false, strTimer=null, strStart=0, strTimeEl=null, subAgents={}, liveTools={}, turnUsage=null, seenAgentEvents=new Set(), liveTurnId=null, cleanCancel=false;
    function streamStartUI(startedAt){ if(strEl)return; clearPending(); curTextEl=null; curTextRaw=''; sawText=false; const at=Number(startedAt); strStart=Number.isFinite(at)&&at>0?Math.min(at,Date.now()):Date.now(); subAgents={}; liveTools={}; turnUsage=null;
      strEl=document.createElement('div'); strEl.className='msg bot streaming';
      // loading + timer FICAM NO FIM do bloco (abaixo da atividade): strflow primeiro, strhead depois.
      strEl.innerHTML='<div class="strflow"></div><div class="strhead"><span class="spin"></span><span class="strtime">0s</span></div>';
      strTimeEl=strEl.querySelector('.strtime'); strFlow=strEl.querySelector('.strflow');
      strTimer=setInterval(()=>{ if(!strTimeEl)return; const s=Math.floor((Date.now()-strStart)/1000); strTimeEl.textContent=(s>=60?`${Math.floor(s/60)}m ${s%60}s`:`${s}s`); },1000);
      E.log.appendChild(strEl); autoScroll(); }
    function closeTextBlock(){ curTextEl=null; curTextRaw=''; }   // próximo texto abre bloco novo (após tool)
    // A collapsible container for one spawned sub-agent (Task tool). Its nested tool calls +
    // text preview show "o que ele está fazendo"; the count badge shows progress at a glance.
    function ensureSubAgent(id,desc,executionId){ if(!strFlow)streamStartUI(); if(subAgents[id]){ if(desc)subAgents[id].title.textContent=desc; if(executionId)bindInlineWork(subAgents[id],executionId); return subAgents[id]; }
      const wrap=document.createElement('div'); wrap.className='subagent'; wrap.dataset.id=id;
      wrap.innerHTML='<div class="sahead"><span class="satog">▸</span><span>🤖</span><span class="satitle"></span><span class="sastate"></span><span class="sacount">0</span><button type="button" class="saopen" title="Abrir em Trabalhos">abrir</button></div><div class="sabody hidden"></div>';
      const head=wrap.querySelector('.sahead'), body=wrap.querySelector('.sabody'), title=wrap.querySelector('.satitle'), countEl=wrap.querySelector('.sacount'), tog=wrap.querySelector('.satog'), open=wrap.querySelector('.saopen');
      title.textContent=desc||'sub-agente';
      head.onclick=()=>{ const hid=body.classList.toggle('hidden'); tog.textContent=hid?'▸':'▾'; };
      closeTextBlock(); strFlow.appendChild(wrap);
      const rec={wrap,body,title,countEl,open,count:0,preview:null,previewText:''}; subAgents[id]=rec; if(executionId)bindInlineWork(rec,executionId); return rec; }
    function bindInlineWork(rec,executionId){ if(!rec||!rec.open||!executionId)return; rec.wrap.dataset.executionId=executionId; rec.open.classList.add('ready'); rec.open.onclick=e=>{e.stopPropagation();openWorkPanel();openWorkNode(executionId);}; const n=workNodes.get(executionId);if(n){if(n.title)rec.title.textContent=n.title;rec.wrap.dataset.state=n.state||'unknown';const state=rec.wrap.querySelector('.sastate');if(state)state.textContent=workStateLabel(n.state).toLowerCase();} }
    function streamTool(name,summary,toolId,parentId,path,adds,dels,rows,detail,status,error,executionId){ if(!strFlow)streamStartUI();
      const readKey=readToolKey(name,path,summary,detail,parentId);
      const liveKey=readKey||(toolId?(parentId||'root')+'\0'+toolId:'');
      if(liveKey&&liveTools[liveKey]){ const row=liveTools[liveKey]; if(summary){row.dataset.sum=summary;const ttl=row.querySelector('.ttl');if(ttl)ttl.textContent=(status&&status!=='started'?pastify(name,summary):summary)||name||'';} if(status&&status!=='started')setToolDone(row); if(status==='failed'){row.classList.add('terr');row.title=error||'Falha na ferramenta';} autoScroll(); return; }
      if(parentId){ const sa=ensureSubAgent(parentId,null,executionId); flipDone(sa.body); const row=toolRowEl(name,summary,path,adds,dels,status!=='started',rows,detail); sa.body.appendChild(row); if(liveKey)liveTools[liveKey]=row; sa.count++; sa.countEl.textContent=sa.count; autoScroll(); return; }
      if((name==='Task'||name==='Agent')&&toolId){ flipDone(strFlow); ensureSubAgent(toolId,(summary||'').replace(/^Subagente:\s*/,'')||'sub-agente',executionId); autoScroll(); return; }
      closeTextBlock(); flipDone(strFlow); const row=toolRowEl(name,summary,path,adds,dels,status!=='started',rows,detail); if(status==='failed'){row.classList.add('terr');row.title=error||'Falha na ferramenta';} strFlow.appendChild(row); if(liveKey)liveTools[liveKey]=row; autoScroll(); }
    function streamThinking(text,parentId,executionId){ streamTool('Thinking',text||'Pensando…','thinking:'+Object.keys(liveTools).length,parentId,null,0,0,null,null,'started',null,executionId); }
    function streamText(t,parentId,executionId){
      if(parentId){ const sa=ensureSubAgent(parentId,null,executionId); if(!sa.preview){ sa.preview=document.createElement('div'); sa.preview.className='sapreview'; sa.body.appendChild(sa.preview); } sa.previewText+=t; sa.preview.textContent=sa.previewText.slice(-240); autoScroll(); return; }
      if(!strFlow)streamStartUI();
      // Abre um bloco NOVO de texto se o anterior foi fechado por uma ferramenta; senão acumula.
      // Um novo bloco de texto significa que as ferramentas anteriores já terminaram → passa pra passado.
      if(!curTextEl){ flipDone(strFlow); curTextEl=document.createElement('div'); curTextEl.className='strtext done'; curTextRaw=''; strFlow.appendChild(curTextEl); }
      curTextRaw+=t; curTextEl.innerHTML=md(curTextRaw); sawText=true; autoScroll(); }
    function streamFinish(){ strEl=strFlow=curTextEl=strTimeEl=null; curTextRaw=''; sawText=false; liveTools={}; turnUsage=null; }
    function usageCostText(usage,digits=4){ if(!usage||!(usage.costUsd>=0))return''; const p=usage.costKind==='billed'?'$':usage.costKind==='estimated_api_equivalent'?'≈$':'Σ$'; return p+Number(usage.costUsd||0).toFixed(digits); }
    function usageSummary(usage){ if(!usage)return''; const cost=usageCostText(usage); const toks=usage.outputTokens||0; const kind=usage.costKind==='billed'?'cobrado reportado':usage.costKind==='estimated_api_equivalent'?'equivalente estimado':usage.costKind==='subscription_included'?'incluído na assinatura':usage.costKind==='tokens_only'?'somente tokens':'custo indisponível'; return `${cost?cost+' · ':''}${toks} tokens · ${kind}`; }
    function streamDone(finalText,usage){ if(strTimer){clearInterval(strTimer);strTimer=null;}
      if(!strEl){ addMsg({role:'assistant',text:finalText||''}); return; }
      const head=strEl.querySelector('.strhead'); if(head) head.remove();
      strEl.querySelectorAll('.strtool[data-name]').forEach(setToolDone); // editando… → editado
      // Os blocos de texto já foram renderizados intercalados; só usa finalText se NADA foi streamado
      // (ex.: resposta veio só no result), pra não duplicar o que já está na tela.
      if(!sawText && finalText){ const d=document.createElement('div'); d.className='strtext done'; d.innerHTML=md(finalText); strFlow.appendChild(d); }
      // Marcador CLARO de conclusão (o resultado é o texto logo acima) — "não sei se terminou" resolvido.
      const secs=strStart?Math.round((Date.now()-strStart)/1000):0; const tstr=secs>=60?`${Math.floor(secs/60)}m ${secs%60}s`:`${secs}s`;
      const f=document.createElement('div'); f.className='strdone';
      f.innerHTML=`<span class="dchk">✓</span><span>Concluído · ${tstr}</span>`+(usageCostText(usage)?` · <span class="dcost">${usageCostText(usage)}</span>`:'');
      strEl.appendChild(f);
      if(usage){ E.usage.textContent=usageSummary(usage); const context=usage.contextTokens||usage.inputTokens; if(context){lastInputTokens=context; if(usage.contextWindowTokens)lastContextWindow=usage.contextWindowTokens; updUsagePill();} }
      streamFinish(); autoScroll(); }
    function streamCancelled(reason){ if(strTimer){clearInterval(strTimer);strTimer=null;} clearPending();
      if(currentSession) delete stopping[sessionStateKey(currentSession,currentSessionRunner)]; updateStopStatus();   // parou → limpa o "parando…" da sessão
      if(cleanCancel){ cleanCancel=false; if(strEl)strEl.remove(); streamFinish(); autoScroll(); return; }  // cancel limpo: a msg voltou ao input → sem bloco "interrompido"
      if(strEl){ const head=strEl.querySelector('.strhead'); if(head) head.remove();
        strEl.querySelectorAll('.strtool[data-name]').forEach(setToolDone);
        const n=document.createElement('div'); n.className='usage'; n.textContent='⏹ '+(reason||'interrompido'); strEl.appendChild(n);
        streamFinish(); }
      else addErr('⏹ '+(reason||'interrompido')); autoScroll(); }
    function streamErr(message){ if(strTimer){clearInterval(strTimer);strTimer=null;} clearPending(); if(strEl){ const head=strEl.querySelector('.strhead'); if(head)head.remove(); strEl.querySelectorAll('.strtool[data-name]').forEach(setToolDone); const n=document.createElement('div'); n.className='usage err'; n.textContent='⚠ '+(message||'Falha na execução'); strEl.appendChild(n); streamFinish(); } else addErr(message||'Falha na execução'); autoScroll(); }
    function addErr(t){ const d=document.createElement('div'); d.className='msg err'; d.textContent=t; E.log.appendChild(d); }
    function searchCardHtml(m){ let h='<b>🔎 '+esc(m.query)+'</b>'+md(m.answer||'');
      (m.matches||[]).forEach(x=>{ h+=`<div class="match" data-id="${esc(x.id)}" data-runner="${esc(x.runnerId||'')}">📂 <b>${esc(x.title||x.id)}</b> <span class="chip">${esc(x.agent||'')}</span>`+
        (x.why||x.progress?`<br><span class="mut">${esc(x.why||x.progress||'')}</span>`:'')+
        (m.action?`<br><button type="button" class="exec ghost" data-id="${esc(x.id)}" data-runner="${esc(x.runnerId||'')}" data-action="${esc(m.action)}">▶ executar ação</button>`:'')+`</div>`; });
      return h; }
    function addSearchCard(m){ const d=document.createElement('div'); d.className='msg bot'; d.innerHTML=searchCardHtml(m); E.log.appendChild(d); autoScroll(); if(m.audio) playTTS(m.audio); }
    function renderSearchInto(c,m){ c.innerHTML=searchCardHtml(m); if(m.audio) playTTS(m.audio); }
    // Filtro literal (busca digitada): lista de sessões cujo título/conversa contém os termos. Sem áudio.
    function hitsHtml(m){ const hits=m.hits||[]; const more=(m.done===false);
      if(!hits.length) return more?'<div class="mut">Buscando…</div>':'<div class="mut">Nada encontrado para “'+esc(m.query)+'”.</div>';
      return '<div class="mut" style="margin-bottom:6px">'+hits.length+' sessão(ões)'+(more?' · buscando mais…':'')+'</div>'+hits.map(x=>`<div class="match" data-id="${esc(x.id)}" data-runner="${esc(x.runnerId||'')}">📂 <b>${esc(x.title||x.id)}</b> <span class="chip">${esc(x.agent||'')}</span>`+
        (x.snippet && x.where==='content'?`<br><span class="mut">${esc(x.snippet)}</span>`:'')+
        (x.cwd?`<br><span class="mut" style="font-size:11px;opacity:.7">${esc(base(x.cwd))}</span>`:'')+`</div>`).join('')+(more?'<div class="mut" style="margin-top:8px;opacity:.7">🔎 buscando em mais sessões…</div>':''); }
    function renderHits(c,m){ c.innerHTML=hitsHtml(m); }
    // Files touched by tools in this conversation (real paths + action + diff counts),
    // sent by the server from the session's claude jsonl. Clicking opens the side panel.
    let curFiles=[];
    const fileActIcon = a => a==='edit'?'✏️':a==='write'?'➕':'📄';
    // Abas: uma lista visível por vez, ocupando toda a altura. Antes as duas dividiam o espaço.
    function selectTab(t){ const rec=(t!=='files'); cfg.tab=rec?'rec':'files'; saveCfg();
      E.recPane.classList.toggle('hidden',!rec); E.filesPane.classList.toggle('hidden',rec);
      E.tabRec.classList.toggle('active',rec); E.tabFiles.classList.toggle('active',!rec);
      if(rec) renderRecents(); else renderFiles(); }
    function secCounts(){ if(E.recCnt) E.recCnt.textContent = sessions.length ? String(sessions.length) : '';
      if(E.filesCnt) E.filesCnt.textContent = curFiles.length ? String(curFiles.length) : ''; }
    function nearPaneBottom(el,px=160){ return !!el && (el.scrollHeight - el.scrollTop - el.clientHeight) < px; }
    function scheduleAutoPager(fn){ requestAnimationFrame(()=>{ fn(); requestAnimationFrame(fn); }); }
    function renderFiles(){ E.files.innerHTML=''; secCounts();
      curFiles.slice(0,filesShown).forEach(f=>{ const d=document.createElement('div'); d.className='item readable'; d.title=f.path;
        const nm=(f.path||'').split(/[\\/]/).pop()||f.path;
        const cnt=(f.action==='edit'&&(f.adds||f.dels))?` <span class="fadd">+${f.adds||0}</span> <span class="fdel">-${f.dels||0}</span>`:'';
        d.innerHTML=`<span class="rbadge">${fileActIcon(f.action)}</span><span class="rtitle">${esc(nm)}</span>${cnt}`;
        d.onclick=()=>openFile(f.path,f.action); E.files.appendChild(d); });
      if(E.filesMore){ const resta=curFiles.length-filesShown;
        E.filesMore.textContent = resta>0 ? `Mostrar mais (${resta})` : 'Mostrar mais';
        E.filesMore.classList.toggle('hidden', resta<=0); }
      scheduleAutoPager(maybeAutoMoreFiles); }
    function loadMoreFiles(){ if(curFiles.length<=filesShown)return; filesShown=Math.min(curFiles.length,filesShown+30); renderFiles(); }
    function maybeAutoMoreFiles(){ if(!E.filesPane||E.filesPane.classList.contains('hidden')||curFiles.length<=filesShown)return; if(nearPaneBottom(E.filesPane)||E.filesPane.scrollHeight<=E.filesPane.clientHeight+40)loadMoreFiles(); }
    E.filesMore.onclick=loadMoreFiles;
    if(E.filesPane)E.filesPane.addEventListener('scroll',maybeAutoMoreFiles);
    // Upsert a file touched during a LIVE turn (from the stream tool events).
    function touchFile(path,action,adds,dels){ if(!path)return; let f=curFiles.find(x=>x.path===path);
      if(!f){ f={path,action:action||'read',adds:adds||0,dels:dels||0}; curFiles.unshift(f); }
      else { if(action==='edit') f.action='edit'; if(adds!=null)f.adds=(f.adds||0)+adds; if(dels!=null)f.dels=(f.dels||0)+dels; }
      renderFiles(); }
    // Painel de arquivo com DOIS modos: diff (só a alteração) e arquivo completo (igual no chat).
    // curFileDiffable = há um diff pra mostrar (aberto por uma edição, numa sessão). Guardado pra
    // o toggle poder recarregar o outro modo sem reabrir.
    let curFilePath='', curFileView='full', curFileDiffable=false;
    function setWorkFileSplit(on){ const app=document.getElementById('app'); if(app)app.classList.toggle('work-file-split',!!on); }
    function closeFilePanel(){ E.filePanel.classList.add('hidden'); setWorkFileSplit(false); }
    function openFile(path,action,opts){ const keep=!!(opts&&opts.keepWork); if(E.workPanel&&!E.workPanel.classList.contains('hidden')&&!keep)closeWorkPanel(); setWorkFileSplit(keep); E.filePanel.classList.remove('hidden'); E.fileName.textContent=path.split(/[\\/]/).pop()||path; E.fileName.title=path;
      curFilePath=path; curFileDiffable=(action==='edit' && !!currentSession); curFileView=curFileDiffable?'diff':'full';
      renderFileViewBtns(); loadFileView(); }
    function loadFileView(){ E.fileStat.textContent=''; E.fileMeta.textContent=curFilePath; E.fileBody.className='filebody plain'; E.fileBody.textContent='Carregando…';
      if(curFileView==='diff' && curFileDiffable){ tx({t:'readdiff',sessionId:currentSession,path:curFilePath}); } else { tx({t:'readfile',path:curFilePath,cwd:curCwd}); } }
    function renderFileViewBtns(){ if(!E.fileView)return; E.fileView.classList.toggle('hidden',!curFileDiffable); // sem diff → sem toggle (só arquivo)
      E.fileView.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.v===curFileView)); }
    if(E.fileView) E.fileView.querySelectorAll('button').forEach(b=>b.onclick=()=>{ if(curFileView===b.dataset.v)return; curFileView=b.dataset.v; renderFileViewBtns(); loadFileView(); });
    // Shows the underlying native session id (real claude/codex session) bound to this UI session,
    // so the user can see it "aparecer" and resume it in a terminal. Click = copy the resume command.
    function renderNativeChip(){ const c=E.nativeChip; if(!c)return; if(!curNativeId){ c.classList.add('hidden'); c.textContent=''; return; }
      const cli=(currentAgent==='codex')?'codex':'claude'; const short=curNativeId.length>10?curNativeId.slice(0,8)+'…':curNativeId;
      c.textContent='🔗 '+short; c.dataset.cmd=cli+' --resume '+curNativeId; c.title='No terminal: '+c.dataset.cmd+' — clique para copiar'; c.classList.remove('hidden'); }
    E.nativeChip.onclick=()=>{ const cmd=E.nativeChip.dataset.cmd||''; if(!cmd)return; (navigator.clipboard?navigator.clipboard.writeText(cmd):Promise.reject()).then(()=>{ const o=E.nativeChip.textContent; E.nativeChip.textContent='copiado ✓'; setTimeout(()=>E.nativeChip.textContent=o,1400); }).catch(()=>toast(cmd)); };
    // ---- lightweight, self-contained syntax highlighter (no external deps) ----
    const HL_KW={ ts:'abstract as async await break case catch class const continue declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface keyof let namespace new null of private protected public readonly return satisfies set static super switch this throw true try type typeof undefined var void while yield',
      py:'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield False None True',
      sh:'if then elif else fi for while until do done case esac in function return local export readonly echo cd exit set unset source',
      sql:'select from where insert into update delete create table alter drop join left right inner outer on group order by having limit offset union values set distinct as and or not null primary key foreign references default' };
    const HL_LIT=new Set(['true','false','null','undefined','None','True','False','nil','NaN','Infinity']);
    function hlLang(name){ const e=(String(name||'').split('.').pop()||'').toLowerCase();
      if(['ts','tsx','js','jsx','mjs','cjs','json','jsonc','css','scss','less','go','rs','java','c','cc','cpp','h','hpp','cs','php','kt','swift','dart','proto'].includes(e)) return 'ts';
      if(['py','rb'].includes(e)) return 'py';
      if(['sh','bash','zsh','env','ps1','yml','yaml','toml','ini','conf','dockerfile'].includes(e)) return 'sh';
      if(e==='sql') return 'sql';
      if(['html','htm','xhtml','xml','vue','svelte'].includes(e)) return 'html';
      return null; }
    function hlEsc(s){ return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
    const HL_RX={ ts:/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d[\w.]*\b)|([A-Za-z_$][\w$]*)/g,
      hash:/(#[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d[\w.]*\b)|([A-Za-z_$][\w$]*)/g,
      // HTML/XML has tag-based structure, not statement/expression tokens — its own pass:
      // comments, <tag / </tag / > / />  punctuation, quoted attribute values, attribute names.
      html:/(<!--[\s\S]*?-->)|(<\/?[A-Za-z][\w:-]*|\/?>)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|([A-Za-z_:][\w:.-]*(?=\s*=\s*["']))/g };
    function highlight(code,name){ const lang=hlLang(name); if(!lang||!code||code.length>300000) return null;
      if(lang==='html'){ const rx=HL_RX.html; rx.lastIndex=0;
        let out='',last=0,m; while((m=rx.exec(code))){ out+=hlEsc(code.slice(last,m.index)); last=rx.lastIndex;
          if(m[1]) out+='<span class="hl-com">'+hlEsc(m[1])+'</span>';
          else if(m[2]) out+='<span class="hl-tag">'+hlEsc(m[2])+'</span>';
          else if(m[3]) out+='<span class="hl-str">'+hlEsc(m[3])+'</span>';
          else if(m[4]) out+='<span class="hl-attr">'+hlEsc(m[4])+'</span>'; }
        return out+hlEsc(code.slice(last)); }
      const kw=new Set((HL_KW[lang]||HL_KW.ts).split(' ')); const rx=(lang==='py'||lang==='sh')?HL_RX.hash:HL_RX.ts; rx.lastIndex=0;
      let out='',last=0,m; while((m=rx.exec(code))){ out+=hlEsc(code.slice(last,m.index)); last=rx.lastIndex;
        if(m[1]) out+='<span class="hl-com">'+hlEsc(m[1])+'</span>';
        else if(m[2]) out+='<span class="hl-str">'+hlEsc(m[2])+'</span>';
        else if(m[3]) out+='<span class="hl-num">'+hlEsc(m[3])+'</span>';
        else { const w=m[4]; out+= kw.has(w)?'<span class="hl-kw">'+w+'</span>' : HL_LIT.has(w)?'<span class="hl-lit">'+w+'</span>' : /^[A-Z]/.test(w)?'<span class="hl-type">'+w+'</span>' : code[rx.lastIndex]==='('?'<span class="hl-fn">'+w+'</span>':hlEsc(w); } }
      return out+hlEsc(code.slice(last)); }
    function showFile(m){ if(E.filePanel.classList.contains('hidden'))return; E.fileName.textContent=m.name||(m.path||'').split(/[\\/]/).pop()||'arquivo'; E.fileName.title=m.path||''; E.fileStat.textContent=''; E.fileBody.className='filebody plain';
      if(m.error){ E.fileMeta.textContent=m.path||''; E.fileBody.textContent='⚠ '+m.error; return; }
      const kb=m.size?(m.size<1024?m.size+' B':(m.size/1024).toFixed(1)+' KB'):''; E.fileMeta.textContent=(m.path||'')+(kb?' · '+kb:'')+(m.truncated?' · (primeiros 512KB)':'');
      if(m.image&&m.content){ const src='data:'+(m.mime||'image/*')+';base64,'+m.content; E.fileBody.className='filebody plain'; E.fileBody.innerHTML='';
        const im=document.createElement('img'); im.src=src; im.alt=m.name||''; im.style.cssText='max-width:100%;height:auto;border-radius:8px;cursor:zoom-in;display:block'; im.onclick=()=>openImg(src); E.fileBody.appendChild(im); E.fileBody.scrollTop=0; return; }
      const hl=highlight(m.content||'',m.name||m.path); if(hl!=null){ E.fileBody.classList.add('code'); E.fileBody.innerHTML=hl; } else E.fileBody.textContent=m.content||''; E.fileBody.scrollTop=0; }
    function showDiff(m){ if(E.filePanel.classList.contains('hidden'))return; E.fileName.textContent=m.name||(m.path||'').split(/[\\/]/).pop()||'arquivo'; E.fileName.title=m.path||''; E.fileMeta.textContent=m.path||'';
      if(m.error){ E.fileStat.textContent=''; E.fileBody.className='filebody plain'; E.fileBody.textContent='⚠ '+m.error; return; }
      E.fileStat.innerHTML=`<span class="add">+${m.adds||0}</span> <span class="del">-${m.dels||0}</span>`;
      E.fileBody.className='filebody'; E.fileBody.innerHTML='';
      (m.rows||[]).forEach(r=>{ const cls=r.t==='+'?'add':r.t==='-'?'del':r.t==='@'?'sec':'ctx'; const ln=document.createElement('span'); ln.className='dline '+cls; ln.textContent=r.s; E.fileBody.appendChild(ln); });
      E.fileBody.scrollTop=0; }

    // Ao enviar, a sessão vira a MAIS RECENTE → sobe pro topo do menu na hora (o servidor confirma depois).
    let lastBump=null;
    function bumpSession(sid){ if(!sid)return; const runner=sessionRunner(); lastBump={sid,runner,ts:Date.now()}; const i=sessions.findIndex(s=>s.id===sid&&(currentMachine!=='all'||(s.runnerId||'local')===runner)); if(i>0){ const [s]=sessions.splice(i,1); sessions.unshift(s); renderRecents(); } }
    function renderRecents(){ E.recents.innerHTML='';
      const visibleRuns=currentMachine==='all'?sessions.filter(s=>(activeRunsByRunner[s.runnerId||'local']||[]).includes(s.id)).length:activeRuns.length;
      if(visibleRuns){ const h=document.createElement('div'); h.className='runhdr'; h.textContent='▶ '+visibleRuns+' rodando agora'; E.recents.appendChild(h); }
      secCounts();
      sessions.slice(0,shown).forEach(s=>{ const runner=s.runnerId||selectedRunner(), run=(activeRunsByRunner[runner]||[]).includes(s.id), un=unread.has(sessionStateKey(s.id,runner))&&!run&&!(s.id===currentSession&&runner===currentSessionRunner);
      const d=document.createElement('div'); d.className='item'+(s.id===currentSession&&runner===currentSessionRunner?' active':'')+(run?' running':'')+(un?' unread':'');
      const nat=isNative(s.id);
      // "nativo" NÃO vai mais na listagem (encurtava o nome da sessão); a marca de nativo continua no tooltip (title) do item.
      const mb=(currentMachine==='all'&&s.machine)?`<span class="rmachine" style="--mh:${machineHue(s.machine)}" title="Máquina: ${esc(s.machine)}">${esc(s.machine)}</span>`:'';
      d.innerHTML=`<span class="rdot"></span><span class="rbadge" title="${esc(s.agent||'')}">${agentIcon(s.agent)}</span><span class="rtitle">${esc(s.title||'Sessão')}</span>${mb}`;
      const sum=document.createElement('button'); sum.type='button'; sum.className='rsum'; sum.title='Resumir e falar (não entra no histórico)';
      const busySum=voiceOp==='summarize'&&voiceOpSid===s.id; sum.textContent=busySum?'⏳':'🔊'; if(busySum){ sum.disabled=true; sum.classList.add('busy'); voiceOpBtn=sum; }
      sum.onclick=(e)=>{ e.stopPropagation(); if(!startVoiceOp('summarize',sum,'⏳',s.id))return; status('speaking',t('stSummarizing')); tx({t:'summarize',sessionId:s.id,speak:true}); }; d.appendChild(sum);
      const del=document.createElement('button'); del.type='button'; del.className='rdel'; del.title='Remover conversa'; del.textContent='🗑';
      del.onclick=async(e)=>{ e.stopPropagation(); const ia=(s.agent==='codex')?'codex':'claude';
        const ok=await dialog({title:`Remover "${s.title||'conversa'}"? Apaga no Jarvis e a sessão no ${ia} — não dá pra desfazer.`, okText:'Remover', danger:true});
        if(!ok) return;
        // NÃO remove da lista aqui — só marca "removendo" e espera o servidor confirmar.
        // A lista só some quando o servidor apaga de fato e reenvia as sessões (evita
        // "sumiço fantasma": esconder na tela sem ter apagado no servidor).
        del.textContent='⏳'; del.disabled=true;
        tx({t:'delete',sessionId:s.id,alsoNative:true});
        setTimeout(()=>{ if(del.isConnected){ del.textContent='🗑'; del.disabled=false; toast(t('tDelNoResp')); } }, 6000); };
      d.appendChild(del);
      d.title=`${s.title||'Sessão'}\n— ${s.agent||''}${nat?' · nativo (somente leitura)':''}\n${s.cwd||''}`;
      d.onclick=()=>{ openSession(s.id,runner); closeSide(); };
      E.recents.appendChild(d); });
      E.moreBtn.classList.toggle('hidden', sessions.length<=shown); scheduleAutoPager(maybeAutoMoreRecents); }
    function loadMoreRecents(){ if(sessions.length<=shown)return; shown=Math.min(sessions.length,shown+20); renderRecents(); }
    function maybeAutoMoreRecents(){ if(!E.recPane||E.recPane.classList.contains('hidden')||sessions.length<=shown)return; if(nearPaneBottom(E.recPane)||E.recPane.scrollHeight<=E.recPane.clientHeight+40)loadMoreRecents(); }
    E.moreBtn.onclick=loadMoreRecents;
    if(E.recPane)E.recPane.addEventListener('scroll',maybeAutoMoreRecents);

    // ---------- seletor de máquina (runners) ----------
    function renderMachines(){
      if(!E.machineBar) return;
      if(machines.length<=1){ E.machineBar.style.display='none'; return; }
      if(currentMachine!=='all' && !machines.some(m=>m.id===currentMachine)) currentMachine='local';
      E.machineBar.style.display=''; E.machineBar.innerHTML='';
      const isAll=currentMachine==='all';
      const cur=isAll?{label:'Todas as máquinas',online:true}:(machines.find(m=>m.id===currentMachine)||machines[0]);
      const bar=document.createElement('div'); bar.className='mbcur';
      bar.innerHTML='<span class="mdot '+(cur.online?'on':'off')+'"></span><span class="mname">'+(isAll?'🌐 ':'')+esc(cur.label)+'</span><span class="mcaret">▾</span>';
      bar.onclick=()=>{ const mm=document.getElementById('mmenu'); if(mm) mm.classList.toggle('hidden'); };
      E.machineBar.appendChild(bar);
      const menu=document.createElement('div'); menu.className='mmenu hidden'; menu.id='mmenu';
      // "Todas as máquinas" (visão unificada) no topo do seletor
      { const allIt=document.createElement('div'); allIt.className='mitem'+(isAll?' active':'');
        allIt.innerHTML='<span class="mdot on"></span><span class="mname">🌐 Todas as máquinas</span><span class="mtag">unificado</span>';
        allIt.onclick=(e)=>{ e.stopPropagation(); selectMachine('all'); }; menu.appendChild(allIt); }
      machines.forEach(m=>{ const it=document.createElement('div'); it.className='mitem'+(m.id===currentMachine?' active':'');
        // online mas sem nenhuma IA utilizável (ex.: claude sem login / token expirado → 401)
        const noAI = m.online && Array.isArray(m.agents) && !m.agents.length;
        // versão (commit git) da máquina + aviso de disparidade com o servidor
        const ver = m.commit ? '<span class="mver" title="Build desta máquina'+(m.hubCommit?' · servidor: '+esc(m.hubCommit):'')+'">'+esc(m.commit)+'</span>' : '';
        const drift = m.stale ? '<span class="mtag warn" title="Versão diferente do servidor ('+esc(m.hubCommit||'?')+') — atualize esta máquina">⚠ desatualizada</span>' : '';
        it.innerHTML='<span class="mdot '+(m.online?'on':'off')+'"></span><span class="mname">'+esc(m.label)+'</span>'+ver+(m.local?'<span class="mtag">servidor</span>':(m.online?'':'<span class="mtag">offline</span>'))+drift+(noAI?'<span class="mtag warn" title="Nenhuma CLI suportada e autenticada foi detectada nesta máquina">⚠ sem IA</span>':'');
        it.onclick=(e)=>{ e.stopPropagation(); selectMachine(m.id); };
        if(authUser&&authUser.role==='owner'){ const pen=document.createElement('button'); pen.className='mpen'; pen.textContent='✏'; pen.title='Renomear';
          pen.onclick=async(e)=>{ e.stopPropagation(); const v=await dialog({title:'Renomear máquina',input:true,value:m.label,placeholder:'Nome da máquina'}); if(v&&v.trim()) tx({t:'rename_runner',runnerId:m.id,label:v.trim()}); };
          it.appendChild(pen); }
        menu.appendChild(it); });
      E.machineBar.appendChild(menu);
    }
    function selectMachine(id){ const mm=document.getElementById('mmenu'); if(mm)mm.classList.add('hidden'); if(id===currentMachine) return;
      if(currentSession!=null){ draftBySession[sessionStateKey(currentSession,currentSessionRunner)]=E.input.value; saveDrafts(); }
      stashAttachments(currentSession,currentSessionRunner);
      currentMachine=id; restoringMachine=false; openingSession=null; try{localStorage.setItem('jarvis_machine',id);}catch{} currentSession=null; currentSessionRunner=id==='all'?(routedMachine||'local'):id; activeRuns=activeRunsByRunner[currentSessionRunner]||[]; curStarted=false; attachments=[]; renderAttach(); clearQueue(); E.log.innerHTML=''; E.title.textContent='—'; curNativeId=''; renderNativeChip(); setHash(''); renderMachines();
      if(id==='all'){ tx({t:'listAll'}); } else { routedMachine=id; tx({t:'runner',runnerId:id}); } updateOfflineBanner(); }
    // Per-session offline indicator: a persistent banner when the machine this session lives on is
    // offline, so the user knows WHY a turn won't go through (distinct from the transient "interrompido"
    // a mid-turn drop shows). routedMachine already tracks the current session's machine (incl. 'all').
    function updateOfflineBanner(){
      const el=E.offlineBar; if(!el) return;
      const mac=machines.find(x=>x.id===routedMachine);
      const off=!!currentSession && mac && !mac.online;
      el.classList.toggle('hidden', !off);
      if(off) el.textContent='⚠ '+(mac.label||'Máquina')+' '+t('machineOffline');
    }

    const localCapsFor=n=>caps.find(c=>c.name===n)||{models:[],defaultModel:null,autoModel:false};
    function machineCaps(){ const id=currentMachine==='all'?routedMachine:currentMachine; const m=machines.find(x=>x.id===id); return (m&&m.agentDescriptors&&m.agentDescriptors.length)?m.agentDescriptors:caps; }
    function availableMachineCaps(){ const available=machineAgents(); return machineCaps().filter(c=>available.includes(c.name)); }
    const capsFor = n => machineCaps().find(c=>c.name===n)||{models:[],defaultModel:null,autoModel:false};
    const routineCaps=()=>{ const m=machines.find(x=>x.id===(E.rtRunner.value||'local')), all=(m&&m.agentDescriptors&&m.agentDescriptors.length)?m.agentDescriptors:caps, declared=m&&Array.isArray(m.agents)?m.agents:null, available=declared||all.filter(c=>!['not_installed','unauthenticated'].includes(c.support)).map(c=>c.name); return all.filter(c=>available.includes(c.name)); };
    const routineCapsFor=n=>routineCaps().find(c=>c.name===n)||{models:[],defaultModel:null,autoModel:false};
    function fillSel(sel,items,val){ sel.innerHTML=''; items.forEach(x=>{const o=document.createElement('option'); const isStr=typeof x==='string'; o.value=isStr?x:x.id; o.textContent=isStr?x:(x.label||x.id); if(o.value===val)o.selected=true; sel.appendChild(o);}); sel.classList.toggle('hidden',!items.length); }
    const selectableModels=c=>(c.models||[]).filter(m=>m.selectable!==false);
    const modelControlOf=c=>c.modelControl||(c.capabilities&&c.capabilities.modelControl)||((c.models||[]).some(m=>m.selectable!==false)?'per_turn':'none');
    const modelObj=(agent,id)=>{ if(!id)return null; const ms=capsFor(agent).models||[]; return ms.find(m=>m.id===id)||null; };
    function fillEfforts(effSel,agent,modelId,val){ const m=modelObj(agent,modelId); const efs=(m&&m.efforts)||[]; fillSel(effSel,efs, (efs.includes(val)&&val)||(m&&m.defaultEffort)||efs[0]); }
    // footer pill state: model/effort vary per-message; agent/folder lock once the session starts
    let curModel=null, curEffort=null, curCwd='', curStarted=false;
    const modelLabel=(agent,id)=>{ const m=modelObj(agent,id); return m?(m.label||m.id):(id||'Automático'); };
    const effortsFor=(agent,id)=>{ const c=capsFor(agent), m=id&&(c.models||[]).find(x=>x.id===id); return m?(m.efforts||[]):[...new Set((c.models||[]).flatMap(x=>x.efforts||[]))]; };
    const EFF_PT={minimal:'Mínimo',low:'Baixo',medium:'Médio',high:'Alto',xhigh:'Muito alto',max:'Máximo',ultra:'Ultra',ultracode:'Ultracode'};
    const effLabel=v=>v?(EFF_PT[v]||v):'—';
    const base = p => (p||'').replace(/[\\/]$/,'').split(/[\\/]/).pop()||p;
    // Modelo/esforço são POR SESSÃO — escolher em uma sessão não pode vazar pras outras. cfg.model/
    // cfg.effort (Configurações) continuam sendo só o PADRÃO para sessão NOVA sem preferência salva
    // ainda. Persistido (não só em memória) pra sobreviver a reload.
    const AUTO_AGENT='__jarvis_auto_agent__', AUTO_MODEL='__jarvis_auto__', AUTO_EFFORT='__jarvis_auto_effort__';
    let sessionPrefs={}; try{ sessionPrefs=JSON.parse(localStorage.getItem('jarvis_session_prefs')||'{}'); }catch(e){}
    function saveSessionPrefs(){ try{ localStorage.setItem('jarvis_session_prefs',JSON.stringify(sessionPrefs)); }catch(e){} }
    // Modelo/esforço REAIS que a sessão nativa (criada na máquina) reporta — o servidor lê do transcript.
    // Só as sessões nativas mandam isso; sessão gerenciada deixa null e cai no pref/default como antes.
    let sessDeclModel=null, sessDeclEffort=null, lastRouteReason='';
    function routeAutoFor(sid){ const p=sessionValue(sessionPrefs,sid,sessionRunner())||{}; return {agent:p.agent===AUTO_AGENT,model:p.model===AUTO_MODEL,effort:p.effort===AUTO_EFFORT}; }
    function syncModelEffort(){ const c=capsFor(currentAgent); const pref=sessionValue(sessionPrefs,currentSession,currentSessionRunner)||{};
      // Prioridade do modelo: escolha explícita do usuário nesta sessão > o que a sessão realmente usa
      // (nativa) > default global salvo > default do agente. Assim uma sessão da máquina abre já com o
      // modelo/esforço dela, mas se você trocar pelo seletor a SUA escolha manda dali em diante.
      const perTurn=modelControlOf(c)==='per_turn', models=selectableModels(c);
      const okM=id=>id&&models.some(m=>m.id===id);
      const inheritedModel=okM(pref.model)?pref.model:(okM(sessDeclModel)?sessDeclModel:(okM(cfg.model)?cfg.model:(okM(c.defaultModel)?c.defaultModel:((models[0]||{}).id||null))));
      curModel=perTurn?(pref.model===AUTO_MODEL?null:inheritedModel):null;
      const efs=effortsFor(currentAgent,curModel);
      const okE=e=>e&&efs.includes(e);
      curEffort = pref.effort===AUTO_EFFORT?null:(okE(pref.effort)?pref.effort : (okE(sessDeclEffort)?sessDeclEffort : (okE(cfg.effort)?cfg.effort : ((modelObj(currentAgent,curModel)||{}).defaultEffort||null))));
      renderControls(); }
    function renderControls(){
      const pref=sessionValue(sessionPrefs,currentSession,currentSessionRunner)||{}, agentAuto=!curStarted&&!curNative&&pref.agent===AUTO_AGENT;
      E.agentName.textContent=(agentAuto?'Automático · ':'')+(currentAgent||'—');
      E.cwdName.textContent=base(curCwd)||'—';
      const c=capsFor(currentAgent), control=modelControlOf(c), perTurn=control==='per_turn';
      E.modelName.textContent=perTurn?(curModel?modelLabel(currentAgent,curModel):('Automático'+(sessDeclModel?' · '+modelLabel(currentAgent,sessDeclModel):''))):(control==='configuration_only'?'Configurado na IA':'Automático');
      E.effortName.textContent=curEffort?effLabel(curEffort):('Automático'+(sessDeclEffort?' · '+effLabel(sessDeclEffort):''));
      if(typeof updUsagePill==='function') updUsagePill();
      E.agentBtn.classList.toggle('lock',curStarted||curNative); E.cwdBtn.classList.toggle('lock',curStarted||curNative);
      E.modelBtn.classList.toggle('lock',!perTurn); E.effortBtn.classList.toggle('lock',!perTurn||!effortsFor(currentAgent,curModel).length);
      E.modelBtn.title=perTurn?(lastRouteReason||'Modelo por mensagem'):(control==='configuration_only'?'Modelo definido na configuração da própria IA':'A IA escolhe o modelo');
      E.agentBtn.title=(curStarted||curNative)?'Agente (travado)':'Agente / IA — clique para trocar (só em sessão nova)';
      E.cwdBtn.title=(curStarted||curNative)?((curCwd||'')+' — travada'):((curCwd||'')+' — clique para escolher (só em sessão nova)'); }

    // ---------- new session ----------
    // #6: em "Todas as máquinas" não há máquina atual — escolher onde criar a sessão (só as online).
    function pickMachine(){ return new Promise(res=>{
      const ov=document.createElement('div'); ov.className='modal';
      const card=document.createElement('div'); card.className='card'; card.style.minWidth='260px'; card.innerHTML='<b>Criar sessão em qual máquina?</b>';
      const list=document.createElement('div'); list.style.cssText='display:flex;flex-direction:column;gap:6px;margin-top:12px';
      const done=(v)=>{ if(ov.parentNode) document.body.removeChild(ov); res(v); };
      machines.forEach(m=>{ const b=document.createElement('button'); b.className='ghost'; b.style.cssText='text-align:left;display:flex;align-items:center;gap:8px';
        b.innerHTML='<span class="mdot '+(m.online?'on':'off')+'"></span>'+esc(m.label)+(m.local?' <span class="mut">(servidor)</span>':(m.online?'':' <span class="mut">— offline</span>'));
        b.disabled=!m.online; b.onclick=()=>done(m.id); list.appendChild(b); });
      card.appendChild(list);
      const cancel=document.createElement('button'); cancel.className='ghost'; cancel.textContent='Cancelar'; cancel.style.marginTop='12px'; cancel.onclick=()=>done(null); card.appendChild(cancel);
      ov.appendChild(card); ov.onclick=(e)=>{ if(e.target===ov) done(null); }; document.body.appendChild(ov); }); }
    E.newSess.onclick=async()=>{ // cria sessão vazia (agente/pasta ajustáveis pelos pills até a 1ª msg)
      let target=currentMachine;
      if(currentMachine==='all'){ const mid=await pickMachine(); if(!mid) return; target=mid; if(mid!==routedMachine){ routedMachine=mid; tx({t:'runner',runnerId:mid}); } }
      const pm=machines.find(x=>x.id===target); const avail=(pm&&Array.isArray(pm.agents)&&pm.agents.length)?pm.agents:machineAgents();
      let agent=cfg.agent||currentAgent||(caps[0]||{}).name; if(!avail.includes(agent)) agent=avail[0]||agent;
      const cwd=target==='local'?(cfg.lastCwd||''):''; creatingSession=true; tx({t:'new',agent,cwd}); closeSide(); };

    // ---------- search (input com foco imediato; sem prompt) ----------
    E.searchBtn.onclick=()=>openSearch();
    // O clique no cabecalho minimiza — mas "selecionar" vive dentro dele: sem o guard abaixo,
    // clicar em selecionar fecharia a secao inteira que voce acabou de pedir pra usar.
    E.tabRec.onclick=()=>selectTab('rec');
    E.tabFiles.onclick=()=>selectTab('files');
    selectTab(cfg.tab);
    E.digestBtn.onclick=()=>{ if(!startVoiceOp('digest',E.digestBtn,'⏳ gerando…'))return; status('speaking',t('stAnalyzing')); tx({t:'digest',speak:true}); };
    // Resumir a sessão ATUAL exigia abrir a barra lateral e achar a sessão na lista — no celular,
    // onde a lateral é overlay, isso é o caminho todo. O panorama (🎧) fica só na lateral: dois
    // ícones de áudio lado a lado não diziam qual era o escopo de cada um.
    E.sumHdr.onclick=()=>{ if(!currentSession){ toast(t('tOpenFirst')); return; }
      if(!startVoiceOp('summarize',E.sumHdr,'⏳',currentSession))return; status('speaking',t('stSummarizing')); tx({t:'summarize',sessionId:currentSession,speak:true}); };
    E.qrBtn.onclick=()=>{ tx({t:'qr',url:location.origin}); closeSide(); };
    E.qrClose.onclick=()=>E.qrModal.classList.add('hidden');
    // ---------- painel "Uso & custo" (máquinas + custo por IA/sessão) ----------
    E.fleetBtn.onclick=()=>{ E.fleetBody.innerHTML='Carregando…'; E.fleetModal.classList.remove('hidden'); closeSide(); tx({t:'fleet'}); };
    E.fleetClose.onclick=()=>E.fleetModal.classList.add('hidden');
    // ---------- canvas: overlay central iterativo (voz: resolução de sessão, pasta, confirmação; depois imagens/diagramas) ----------
    function hideCanvas(){ E.canvasModal.classList.add('hidden'); }
    function renderCanvas(m){ if(m.op==='close'){ hideCanvas(); return; }
      E.canvasTitle.textContent=m.title||'🎙 Jarvis'; const b=E.canvasBody; b.innerHTML='';
      const mkRow=()=>{ const r=document.createElement('div'); r.className='row'; r.style.cssText='gap:6px;flex-wrap:wrap;margin-top:10px'; return r; };
      const btn=(txt,cls,fn)=>{ const x=document.createElement('button'); if(cls)x.className=cls; x.textContent=txt; x.style.flex='none'; x.onclick=fn; return x; };
      if(m.kind==='resolve'){
        if(m.utterance){ const u=document.createElement('div'); u.className='mut'; u.style.cssText='font-size:12px;margin-bottom:8px'; u.textContent='você: “'+m.utterance+'”'; b.appendChild(u); }
        const q=document.createElement('div'); q.innerHTML=m.suggestion?('Isso parece a sessão <b>'+esc(m.suggestion.title)+'</b> <span class="mut">('+m.suggestion.score+'%)</span>. Continuar nela ou criar nova?'):'Não achei uma sessão parecida. Continuar na conversa de voz ou criar nova?'; b.appendChild(q);
        const row=mkRow();
        if(m.suggestion){ const t=m.suggestion.title||''; row.appendChild(btn('Continuar em “'+(t.length>22?t.slice(0,22)+'…':t)+'”','',()=>tx({t:'canvas_choice',choice:'session',sessionId:m.suggestion.id}))); }
        row.appendChild(btn('＋ Nova sessão',m.suggestion?'ghost':'',()=>tx({t:'canvas_choice',choice:'new'})));
        row.appendChild(btn('Escolher outra…','ghost',()=>renderCanvas({kind:'pick',title:m.title,recents:m.recents})));
        b.appendChild(row);
      } else if(m.kind==='pick'){
        const list=document.createElement('div'); list.style.cssText='display:flex;flex-direction:column;gap:5px;max-height:44vh;overflow:auto';
        ((m.recents&&m.recents.length?m.recents:sessions)||[]).slice(0,20).forEach(s=>list.appendChild(btn(s.title||s.id,'ghost',()=>tx({t:'canvas_choice',choice:'session',sessionId:s.id}))));
        b.appendChild(list);
      } else if(m.kind==='confirm'){
        const t=document.createElement('div'); t.innerHTML=esc(m.text||''); b.appendChild(t);
        const row=mkRow(); row.style.justifyContent='flex-end'; row.appendChild(btn('Cancelar','ghost',()=>tx({t:'canvas_choice',choice:'cancel'}))); row.appendChild(btn('Confirmar','',()=>tx({t:'canvas_choice',choice:'confirm'}))); b.appendChild(row);
      } else if(m.kind==='info'){
        if(m.text){ const t=document.createElement('div'); t.style.whiteSpace='pre-wrap'; t.innerHTML=md(m.text); b.appendChild(t); }
        if(m.image){ const img=document.createElement('img'); img.src=m.image; img.style.cssText='max-width:100%;border-radius:10px;margin-top:8px'; b.appendChild(img); }
      }
      E.canvasModal.classList.remove('hidden'); }
    E.canvasClose.onclick=()=>{ tx({t:'canvas_choice',choice:'cancel'}); hideCanvas(); };
    function planUsed(w){ return Math.min(100,Math.max(0,Math.round(Number(w?.pct)||0))); }
    function planRemaining(w){ return Math.min(100,Math.max(0,Math.round(Number.isFinite(Number(w?.remainingPct))?Number(w.remainingPct):(100-planUsed(w))))); }
    function planPctText(w){ return `${planUsed(w)}% usado · ${planRemaining(w)}% restante`; }
    function pctBar(w){ const p=planUsed(w), col=p>=90?'#f43f5e':p>=70?'#f59e0b':'#22c55e';
      return `<div style="background:#ffffff14;border-radius:5px;height:7px;overflow:hidden;margin-top:2px"><div style="width:${p}%;height:100%;background:${col}"></div></div><div class="mut" style="font-size:10.5px">${planPctText(w)}${w?.resetsAt?' · reseta '+new Date(w.resetsAt).toLocaleString('pt-BR',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}):''}</div>`; }
    function renderFleet(m){ if(!E.fleetBody)return; const T=m.totals||{}; const mm=m.machines||[]; let h='';
      const agLabel=a=>({'claude-code':'Claude','codex':'Codex','gemini':'Gemini','cursor':'Cursor','copilot':'Copilot','opencode':'OpenCode','cline':'Cline','qwen':'Qwen','continue':'Continue','kiro':'Kiro','antigravity':'Antigravity','aider':'Aider','legacy-unattributed':'Legado não atribuído','unknown':'Legado não atribuído','remote-unknown':'Remoto não atribuído','outro':'Outros'})[a]||a;
      h+='<div class="sec" style="margin:0 0 4px">Configuração nas máquinas</div>';
      mm.forEach(x=>{ const desc=Array.isArray(x.agentDescriptors)?x.agentDescriptors:[], configured=(Array.isArray(x.agents)?x.agents:[]).map(name=>desc.find(d=>d.name===name)||{name,models:[]});
        const rows=configured.length?configured.map(d=>{ const models=(d.models||[]).filter(model=>model.selectable!==false), dm=(models.find(model=>model.id===d.defaultModel)||models[0]||{}), effort=dm.defaultEffort||(dm.efforts&&dm.efforts[0])||'', control=d.modelControl||(d.capabilities&&d.capabilities.modelControl)||((models||[]).length?'per_turn':'none');
          const modelTxt=dm.id?esc(dm.label||dm.id):'automático'; const effortTxt=effort?` · esforço ${esc(effLabel(effort))}`:''; const support=d.support&&d.support!=='complete'?` · ${esc(d.support)}`:'';
          return `<div style="display:flex;gap:6px;align-items:center;font-size:11.5px;padding:1px 0"><span class="mtag">${esc(agLabel(d.name))}</span><span class="mut" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${control==='per_turn'?modelTxt:'configuração da IA'}${effortTxt}${support}</span></div>`; }).join(''):'<div class="mut" style="font-size:11.5px">nenhuma IA executável anunciada</div>';
        h+=`<div style="padding:6px 0;border-bottom:1px solid var(--line)"><div style="display:flex;align-items:center;gap:7px;margin-bottom:3px"><span class="mdot ${x.online?'on':'off'}"></span><span style="color:var(--text);font-weight:600">${esc(x.label||x.id)}</span><span class="mut" style="font-size:10.5px">${x.online?'online':'offline'}${x.commit?' · '+esc(x.commit):''}</span></div>${rows}</div>`; });
      h+=`<div style="display:flex;gap:14px;flex-wrap:wrap;margin:10px 0">
        <div><div style="font-size:20px;font-weight:700;color:var(--text)">${mm.filter(x=>x.online).length}/${mm.length}</div><div class="mut" style="font-size:11px">máquinas online</div></div>
        <div><div style="font-size:20px;font-weight:700;color:var(--text)">${T.active||0}</div><div class="mut" style="font-size:11px">rodando agora</div></div>
        <div><div style="font-size:20px;font-weight:700;color:var(--text)">${T.sessions||0}</div><div class="mut" style="font-size:11px">sessões</div></div>
        <div><div style="font-size:20px;font-weight:700;color:var(--text)">$${(T.billableTotal||0).toFixed(2)}</div><div class="mut" style="font-size:11px">cobrado reportado</div></div>
        <div><div style="font-size:20px;font-weight:700;color:var(--text)">≈$${(T.estimatedTotal||0).toFixed(2)}</div><div class="mut" style="font-size:11px">equivalente estimado</div></div>
        <div title="Consumo de LLM atribuído à voz"><div style="font-size:20px;font-weight:700;color:#a78bfa">≈$${(T.voiceCost||0).toFixed(2)}</div><div class="mut" style="font-size:11px">🎙 voz${T.voicePct?` · ${T.voicePct}% do total`:''}</div></div></div>`;
      const agColor=a=>({'claude-code':'#d97757','codex':'#22c55e','gemini':'#4285f4','cursor':'#e5e7eb','copilot':'#a78bfa','opencode':'#f59e0b','cline':'#ef4444','qwen':'#60a5fa','aider':'#38bdf8'})[a]||'#9aa0a6';
      const costFmt=u=>u&&u.billableUsd>0&&u.estimatedUsd<=0?'$'+u.costUsd.toFixed(2):u&&u.estimatedUsd>0&&u.billableUsd<=0?'≈$'+u.costUsd.toFixed(2):'Σ$'+((u&&u.costUsd)||0).toFixed(2);
      const agRows=Object.entries(T.byAgent||{}).sort((x,y)=>y[1]-x[1]);
      if(agRows.length){ h+='<div class="sec" style="margin:6px 0 4px">Custo por IA</div>';
        const tot=agRows.reduce((s,r)=>s+r[1],0)||1;
        agRows.forEach(([a,v])=>{ const pct=Math.round(v/tot*100);
          h+=`<div style="display:flex;align-items:center;gap:8px;padding:2px 0;font-size:12px">
            <span style="width:8px;height:8px;border-radius:2px;background:${agColor(a)};flex:none"></span>
            <span style="flex:1">${esc(agLabel(a))}</span><span class="mut">${pct}%</span><span style="color:var(--text);font-weight:600">${costFmt((T.byAgentUsage||{})[a])}</span></div>
            <div style="height:4px;border-radius:3px;background:var(--line);overflow:hidden;margin:0 0 3px"><div style="height:100%;width:${pct}%;background:${agColor(a)}"></div></div>`; }); }
      const ts=T.topSessions||[];
      if(ts.length){ h+='<div class="sec" style="margin:8px 0 4px">Sessões mais caras</div>';
        ts.forEach(s=>{ h+=`<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px">
          <span class="mtag" style="border-color:${agColor(s.agent)};color:${agColor(s.agent)}">${esc(agLabel(s.agent))}</span>
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.title||s.id)}</span>
          <span style="color:var(--text);font-weight:600">${costFmt(s.usage)}</span></div>`; }); }
      h+='<div class="sec" style="margin:6px 0 4px">Máquinas</div>';
      mm.forEach(x=>{ const badges=[]; if(x.local)badges.push('<span class="mtag">servidor</span>'); if(!x.online)badges.push(`<span class="mtag">offline${x.offlineMs>60000?` há ${Math.round(x.offlineMs/60000)}m`:''}</span>`);
        if(x.online&&Array.isArray(x.agents)&&!x.agents.length)badges.push('<span class="mtag warn">⚠ sem IA</span>'); if(x.compatible===false)badges.push('<span class="mtag warn">⚠ protocolo incompatível</span>'); if(x.stale)badges.push('<span class="mtag warn">⚠ desatualizada</span>');
        if(x.active>0)badges.push(`<span class="mtag" style="color:#22c55e">▶ ${x.active}</span>`);
        h+=`<div style="display:flex;align-items:center;gap:7px;padding:4px 0;border-bottom:1px solid var(--line)">
          <span class="mdot ${x.online?'on':'off'}"></span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.label||x.id)}${x.commit?` <span class="mut" style="font-size:10.5px">${esc(x.commit)}</span>`:''}</span>${badges.join(' ')}</div>`; });
      const M=m.metrics||{}, ov=M.overall, byR=M.runners||[];
      if(ov&&ov.turns){ const labelOf=id=>{ if(id==='*')return'Total'; const f=mm.find(x=>x.id===id); return f?(f.label||f.id):id; };
        const fmtMs=v=>v>=1000?`${(v/1000).toFixed(1)}s`:`${v||0}ms`; const erColor=r=>r>=0.2?'#ef4444':r>0?'#f59e0b':'#22c55e';
        h+='<div class="sec" style="margin:10px 0 4px">Desempenho dos turnos</div>';
        h+=`<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:6px">
          <div><div style="font-size:16px;font-weight:700;color:var(--text)">${fmtMs(ov.p50ms)}</div><div class="mut" style="font-size:11px">latência p50</div></div>
          <div><div style="font-size:16px;font-weight:700;color:var(--text)">${fmtMs(ov.p95ms)}</div><div class="mut" style="font-size:11px">p95</div></div>
          <div><div style="font-size:16px;font-weight:700;color:${erColor(ov.errorRate)}">${Math.round(ov.errorRate*100)}%</div><div class="mut" style="font-size:11px">erros · ${ov.turns} turno(s)</div></div></div>`;
        byR.forEach(r=>{ h+=`<div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px">
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(labelOf(r.runnerId))}</span>
          <span class="mut">${r.turns}t</span><span class="mut">p50 ${fmtMs(r.p50ms)}</span><span class="mut">p95 ${fmtMs(r.p95ms)}</span>
          <span style="color:${erColor(r.errorRate)}">${Math.round(r.errorRate*100)}%</span></div>`; });
        const dims=[['Por IA',M.agents||[],x=>agLabel(x.key)],['Por modelo',M.models||[],x=>x.key]];
        dims.forEach(([title,rows,label])=>{ if(!rows.length)return; h+=`<div class="mut" style="font-size:11px;margin-top:6px">${title}</div>`; rows.forEach(r=>{h+=`<div style="display:flex;gap:8px;font-size:11.5px;padding:2px 0"><span style="flex:1">${esc(label(r))}</span><span class="mut">${r.turns}t · p50 ${fmtMs(r.p50ms)}</span><span style="color:${erColor(r.errorRate)}">${Math.round(r.errorRate*100)}%</span></div>`;}); }); }
      const plans=m.plans||{}; h+='<div class="sec" style="margin:10px 0 4px">Uso do plano por IA</div>';
      Object.entries(plans).filter(([,e])=>e&&e.agent!=='mock').forEach(([,entry])=>{ const a=entry.agent,p=entry&&entry.plan; h+=`<div class="mut" style="font-size:11.5px;margin-top:7px">${entry.machine?esc(entry.machine)+' · ':''}${esc(agLabel(a))}${p&&p.label?' · '+esc(p.label):''}</div>`;
        if(!p){ const why=entry.status==='unsupported'?'o CLI não publica limites de conta':entry.status==='error'?'erro ao consultar':'nenhum limite reportado'; h+=`<div class="mut" style="font-size:11px">${why}</div>`; return; }
        if(p.fiveHour)h+=pctBar(p.fiveHour); if(p.sevenDay)h+=pctBar(p.sevenDay); (p.extra||[]).forEach(e=>{h+=`<div class="mut" style="font-size:10.5px">${esc(e.label)}</div>${pctBar(e)}`;}); });
      const ph=m.parseHealth; if(ph&&ph.emptyNonEmptyFiles>0){ h+=`<div style="margin-top:10px;color:#f59e0b;font-size:11.5px">⚠ ${ph.emptyNonEmptyFiles} transcript(s) não-vazios parsearam 0 mensagens — possível mudança de formato do CLI.</div>`; }
      E.fleetBody.innerHTML=h; }
    E.fileClose.onclick=closeFilePanel;
    E.fileCopy.onclick=()=>{ const dl=E.fileBody.querySelectorAll('.dline'); const t=dl.length?[...dl].map(x=>x.textContent).join('\n'):(E.fileBody.textContent||''); (navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(()=>{E.fileCopy.textContent='Copiado ✓';setTimeout(()=>E.fileCopy.textContent='Copiar',1500);}).catch(()=>{}); };

    // ---- segurança: dispositivos & convites (dono) ----
    function updateOwnerUI(){ if(authUser&&authUser.role==='owner') E.secBtn.classList.remove('hidden'); else E.secBtn.classList.add('hidden'); }
    E.secBtn.onclick=()=>{ tx({t:'sec_state'}); E.secOut.classList.add('hidden'); E.secModal.classList.remove('hidden'); closeSide(); };
    E.secClose.onclick=()=>E.secModal.classList.add('hidden');
    E.secGen.onclick=()=>{ tx({t:'sec_invite', role:E.secRole.value, ttlSec:Number(E.secTtl.value)}); };
    let secRepoUrl='';
    E.secRunGen.onclick=()=>{ tx({t:'mint_runner', label:E.secRunLabel.value.trim()}); E.secRunLabel.value=''; };
    function copyBox(caption,text){ const w=document.createElement('div'); w.style.marginBottom='8px';
      const c=document.createElement('div'); c.className='sec'; c.style.marginTop='2px'; c.textContent=caption; w.appendChild(c);
      const pre=document.createElement('div'); pre.style.cssText='word-break:break-all;background:#131a22;border:1px solid #2a3542;border-radius:8px;padding:8px;font-family:monospace;font-size:11.5px;color:#e8eef5'; pre.textContent=text; w.appendChild(pre);
      const b=document.createElement('button'); b.type='button'; b.className='ghost'; b.textContent='Copiar'; b.style.marginTop='4px';
      b.onclick=()=>{ (navigator.clipboard?navigator.clipboard.writeText(text):Promise.reject()).then(()=>{b.textContent='Copiado ✓';setTimeout(()=>b.textContent='Copiar',1500);}).catch(()=>toast(text)); };
      w.appendChild(b); return w; }
    function showRunnerCmd(token,label){ const hub=location.origin.replace(/^http/,'ws'); const repo=secRepoUrl||'<url-do-seu-repo>';
      E.secRunOut.classList.remove('hidden'); E.secRunOut.innerHTML='<div class="sec">✅ Máquina "'+esc(label)+'" — comando pronto</div><div class="mut" style="font-size:11px;margin-bottom:6px">Na máquina nova: Node ≥22, git, Tailscale conectado, e <code>claude login</code>.</div>';
      E.secRunOut.appendChild(copyBox('1) Baixar o código:', 'git clone '+repo+'.git && cd jarvis'));
      E.secRunOut.appendChild(copyBox('2a) Windows (PowerShell, na pasta do repo):', ".\\scripts\\install-runner.ps1 -Hub '"+hub+"' -Token '"+token+"' -Label '"+label+"'"));
      E.secRunOut.appendChild(copyBox('2b) Mac/Linux:', "./scripts/install-runner.sh -h '"+hub+"' -t '"+token+"' -l '"+label+"'")); }
    E.secPassSet.onclick=()=>{ const v=E.secPass.value.trim(); if(v.length<8){ toast(t('tPassShort')); return; }
      authPass=v; if(E.secPassRemember.checked) localStorage.setItem('jarvis_pass',v); else localStorage.removeItem('jarvis_pass');
      tx({t:'set_pass',new:v}); E.secPass.value=''; };
    E.secPassClear.onclick=()=>{ authPass=''; localStorage.removeItem('jarvis_pass'); tx({t:'clear_pass'}); };
    let revokeAllArmed=0;
    E.secRevokeAll.onclick=()=>{ const now=Date.now(); if(now-revokeAllArmed<4000){ revokeAllArmed=0; E.secRevokeAll.textContent='Revogar todos os outros'; tx({t:'sec_revoke_all'}); }
      else { revokeAllArmed=now; E.secRevokeAll.textContent='Confirmar? (toque de novo)'; setTimeout(()=>{ if(Date.now()-revokeAllArmed>=4000) E.secRevokeAll.textContent='Revogar todos os outros'; },4200); } };
    function fmtAgo(ts){ if(!ts)return'—'; const s=Math.floor((Date.now()-ts)/1000); if(s<60)return'agora'; if(s<3600)return Math.floor(s/60)+'min'; if(s<86400)return Math.floor(s/3600)+'h'; return Math.floor(s/86400)+'d'; }
    function fmtIn(ts){ const s=Math.floor((ts-Date.now())/1000); if(s<=0)return'expirado'; if(s<3600)return Math.floor(s/60)+'min'; if(s<86400)return Math.floor(s/3600)+'h'; return Math.floor(s/86400)+'d'; }
    function secRow(html){ const r=document.createElement('div'); r.style.cssText='display:flex;align-items:center;gap:8px;padding:5px 0;border-top:1px solid #ffffff12'; const i=document.createElement('div'); i.style.cssText='flex:1;min-width:0'; i.innerHTML=html; r.appendChild(i); return r; }
    function renderSec(m){
      const devs=m.devices||[], me=m.me;
      E.secDevices.innerHTML = devs.length ? '' : 'Nenhum dispositivo.';
      devs.forEach(d=>{ const soon=d.expiresAt&&d.expiresAt-Date.now()<86400000; const exp = d.expiresAt ? (' · <span style="'+(soon?'color:#e3b341':'opacity:.55')+'">acesso '+(d.expiresAt<=Date.now()?'expirado':'expira em '+fmtIn(d.expiresAt))+'</span>') : ' · <span style="opacity:.4">permanente</span>';
        const row=secRow('<div style="color:#e8eef5;font-size:13px">'+esc(d.label||'Dispositivo')+(d.id===me?' <span style="opacity:.6">(este)</span>':'')+' · '+esc(d.role||'')+'</div><div style="opacity:.55">'+esc(d.userName||'')+' · visto '+fmtAgo(d.lastSeen)+exp+(d.ip?(' · '+esc(d.ip)):'')+'</div>');
        const rb=document.createElement('button'); rb.className='ghost'; rb.style.flex='none'; rb.textContent=d.role==='owner'?'→ membro':'→ dono'; rb.title='Alterar papel'; rb.onclick=()=>tx({t:'sec_set_role',deviceId:d.id,role:d.role==='owner'?'member':'owner'}); row.appendChild(rb);
        if(d.id!==me){ const b=document.createElement('button'); b.className='ghost'; b.textContent='Revogar'; b.style.flex='none'; b.onclick=()=>tx({t:'sec_revoke_device',deviceId:d.id}); row.appendChild(b); }
        E.secDevices.appendChild(row); });
      const inv=m.invites||[];
      E.secInvites.innerHTML = inv.length ? '' : 'Nenhum convite pendente.';
      inv.forEach(i=>{ const row=secRow('<div style="color:#e8eef5;font-size:13px">'+esc(i.role)+' · expira em '+fmtIn(i.expiresAt)+'</div>');
        const b=document.createElement('button'); b.className='ghost'; b.textContent='Revogar'; b.style.flex='none'; b.onclick=()=>tx({t:'sec_revoke_invite',inviteId:i.id}); row.appendChild(b);
        E.secInvites.appendChild(row); });
      if(E.secPassStatus) E.secPassStatus.textContent = m.hasPass ? '✅ Configurada — pedida em novos logins.' : '⚪ Não configurada.';
      if(m.repoUrl) secRepoUrl=m.repoUrl;
      const runs=m.runnerTokens||[], online=new Set(m.onlineRunners||[]), loc=m.localMachine;
      const renameBtn=(id,label)=>{ const b=document.createElement('button'); b.className='ghost'; b.style.flex='none'; b.textContent='Renomear'; b.onclick=async()=>{ const v=await dialog({title:'Renomear máquina',input:true,value:label||'',placeholder:'Nome da máquina'}); if(v&&v.trim()) tx({t:'rename_runner',runnerId:id,label:v.trim()}); }; return b; };
      if(E.secRunners){ E.secRunners.innerHTML = (runs.length||loc) ? '' : 'Nenhuma máquina adicionada ainda.';
        // máquina principal (o servidor) — sempre listada, sem "Revogar"
        if(loc){ const row=secRow('<div style="color:#e8eef5;font-size:13px">'+esc(loc.label||'Servidor')+' <span style="opacity:.6">(servidor)</span> · <span style="color:#3fb950">online</span></div>');
          row.appendChild(renameBtn(loc.id,loc.label)); E.secRunners.appendChild(row); }
        runs.forEach(rt=>{ const on=rt.online||online.has(rt.runnerId)||!!(machines.find(x=>x.id===rt.runnerId)||{}).online; const row=secRow('<div style="color:#e8eef5;font-size:13px">'+esc(rt.label||rt.runnerId)+' · '+(on?'<span style="color:#3fb950">online</span>':'<span style="opacity:.5">offline</span>')+'</div>');
          row.appendChild(renameBtn(rt.runnerId,rt.label));
          const b=document.createElement('button'); b.className='ghost'; b.textContent='Revogar'; b.style.flex='none'; b.onclick=()=>tx({t:'sec_revoke_runner',runnerId:rt.runnerId}); row.appendChild(b);
          E.secRunners.appendChild(row); }); }
    }
    function showInvite(code){ const link=location.origin+'/#invite='+encodeURIComponent(code);
      E.secOut.classList.remove('hidden');
      E.secOut.innerHTML='<div class="sec">Convite criado — compartilhe o link</div><div style="word-break:break-all;background:#131a22;border:1px solid #2a3542;border-radius:8px;padding:8px;font-size:12px;color:#e8eef5">'+esc(link)+'</div>';
      const mk=(txt,val,ghost)=>{ const b=document.createElement('button'); b.type='button'; if(ghost)b.className='ghost'; b.textContent=txt; b.style.marginTop='6px'; if(ghost)b.style.marginLeft='6px';
        b.onclick=()=>{ (navigator.clipboard?navigator.clipboard.writeText(val):Promise.reject()).then(()=>{ const o=b.textContent; b.textContent='Copiado ✓'; setTimeout(()=>b.textContent=o,1500); }).catch(()=>toast(txt+': '+val)); }; return b; };
      E.secOut.appendChild(mk('Copiar link',link,false));
      E.secOut.appendChild(mk('Copiar só o código',code,true));
    }
    // ---------- Web Push (notificação no aparelho quando termina) ----------
    let pushKeyResolve=null;
    function urlB64ToUint8(b64){ const pad='='.repeat((4-b64.length%4)%4); const s=(b64+pad).replace(/-/g,'+').replace(/_/g,'/'); const raw=atob(s); const arr=new Uint8Array(raw.length); for(let i=0;i<raw.length;i++)arr[i]=raw.charCodeAt(i); return arr; }
    // As prefs vivem NA inscricao (por aparelho): o celular no bolso e o desktop que voce esta
    // encarando querem coisas diferentes, e um interruptor global nao consegue dizer isso.
    let pushSub=null;
    function pushPrefs(){ const ev=[]; if(E.pushDone&&E.pushDone.checked)ev.push('done'); if(E.pushError&&E.pushError.checked)ev.push('error'); if(E.pushMachine&&E.pushMachine.checked)ev.push('machine');
      return { events:ev, mode:(E.pushMode&&E.pushMode.value)||'each', everyMin:Math.min(240,Math.max(1,Number(E.pushEvery&&E.pushEvery.value)||15)) }; }
    function renderPushCfg(){ if(!E.pushCfg)return; E.pushCfg.classList.toggle('hidden', !E.setPush.checked);
      if(E.pushEveryRow) E.pushEveryRow.classList.toggle('hidden', E.pushMode.value!=='grouped'); }
    async function enablePush(){ if(window.__jarvisNative&&window.__jarvisNative.push) return window.__jarvisNative.push(pushPrefs());  // no app nativo, usa FCM/APNs
      if(!('serviceWorker'in navigator)||!('PushManager'in window)){ toast(t('tPushUnsup')); return false; }
      try{ const reg=await navigator.serviceWorker.register('/sw.js');
        if(Notification.permission!=='granted'){ if((await Notification.requestPermission())!=='granted'){ toast(t('tPushDenied')); return false; } }
        const key=await new Promise(res=>{ pushKeyResolve=res; tx({t:'pushkey'}); setTimeout(()=>res(null),5000); });
        if(!key){ toast(t('tPushNoKey')); return false; }
        let sub=await reg.pushManager.getSubscription(); if(!sub) sub=await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:urlB64ToUint8(key)});
        pushSub=sub; tx({t:'subscribe', sub:sub.toJSON(), prefs:pushPrefs()}); cfg.push=true; saveCfg(); return true;
      }catch(e){ toast('Falha ao ativar notificações: '+(e.message||e)); return false; } }
    async function disablePush(){ if(window.__jarvisNative&&window.__jarvisNative.disablePush) return window.__jarvisNative.disablePush();
      cfg.push=false; saveCfg(); try{ const reg=await navigator.serviceWorker.getRegistration(); const sub=reg&&await reg.pushManager.getSubscription(); if(sub){ tx({t:'unsubscribe',endpoint:sub.endpoint}); await sub.unsubscribe(); } }catch(e){} }
    // --- Native shell bridge (Capacitor). Populated ONLY inside the mobile app; a plain browser hits
    //     the early return and window.__jarvisNative stays undefined, so every PWA path above is
    //     untouched. Plugins are exposed at window.Capacitor.Plugins by the native shell at runtime —
    //     no build-time imports here. Stages 3–4 (share/biometrics/wake-word) extend this same object. ---
    (function(){
      var Cap=window.Capacitor; if(!Cap||!Cap.isNativePlatform||!Cap.isNativePlatform()) return;   // browser → skip
      var P=Cap.Plugins||{}, platform=(Cap.getPlatform&&Cap.getPlatform())||'android';
      var N=window.__jarvisNative={platform:platform};
      try{ document.documentElement.classList.add('native','native-'+platform); }catch(e){}
      // ---- push (FCM/APNs) → registers the device token with the Hub (mobile_push_register) ----
      if(P.PushNotifications){
        var PN=P.PushNotifications, wantEvents=['done','error'];
        PN.addListener('registration',function(t){ if(t&&t.value){ N._lastToken=t.value; tx({t:'mobile_push_register',token:t.value,platform:platform,events:wantEvents}); } });
        PN.addListener('registrationError',function(e){ try{ toast('Push nativo falhou: '+((e&&e.error)||e)); }catch(_){} });
        N.push=async function(prefs){ try{
          wantEvents=(prefs&&prefs.events&&prefs.events.length)?prefs.events:wantEvents;
          var perm=await PN.checkPermissions(); if(perm.receive!=='granted') perm=await PN.requestPermissions();
          if(perm.receive!=='granted'){ toast(t('tPushDenied')); return false; }
          await PN.register(); cfg.push=true; saveCfg(); return true;
        }catch(e){ toast('Falha no push nativo: '+(e.message||e)); return false; } };
        N.disablePush=async function(){ cfg.push=false; saveCfg(); try{ if(N._lastToken) tx({t:'mobile_push_unregister',token:N._lastToken}); }catch(e){} };
        // Re-send the token after each (re)connect + on relaunch (the Hub upserts, so it's cheap).
        N.reregister=function(){ if(N._lastToken) tx({t:'mobile_push_register',token:N._lastToken,platform:platform,events:wantEvents}); else if(cfg.push) N.push(pushPrefs()); };
      }
      // ---- biometric app-unlock (Face ID / fingerprint). Plugin: capacitor-native-biometric (NativeBiometric). ----
      var Bio=P.NativeBiometric;
      if(Bio){
        N.biometricAvailable=async function(){ try{ var r=await Bio.isAvailable(); return !!(r&&r.isAvailable); }catch(e){ return false; } };
        N.unlock=async function(){ try{ await Bio.verifyIdentity({reason:'Desbloquear o Jarvis',title:'Jarvis',subtitle:'Confirme sua identidade',description:''}); return true; }catch(e){ return false; } };
      }
      // ---- share OUT (@capacitor/share) ----
      if(P.Share){ N.share=async function(text,title){ try{ await P.Share.share({title:title||'Jarvis',text:text||''}); return true; }catch(e){ return false; } }; }
      // ---- share INTO Jarvis: the OS share-sheet delivers text via the send-intent plugin; drop it into
      //      the composer. Plugin: send-intent (capacitor-community). The native intent-filter (Android) /
      //      share-extension (iOS) config is required — see docs/mobile.md. ----
      if(P.SendIntent){
        var pullShared=function(){ try{ P.SendIntent.checkSendIntentReceived().then(function(r){ if(r&&(r.text||r.url||r.title)) applyShareIn(r.text||r.url||r.title); }).catch(function(){}); }catch(e){} };
        pullShared(); if(P.App) P.App.addListener('appStateChange',function(s){ if(s&&s.isActive) pullShared(); });
      }
      // ---- background wake-word: custom plugin JarvisWake (mobile/plugins/jarvis-wake). Bridges a
      //      native always-on detector to the voice flow. Web stub → unsupported → clean no-op. ----
      var Wake=P.JarvisWake;
      if(Wake){
        N.wakeStart=async function(){ try{ if(Wake.isSupported){ var s=await Wake.isSupported(); if(s&&s.supported===false) return false; } await Wake.start(); return true; }catch(e){ return false; } };
        N.wakeStop=async function(){ try{ await Wake.stop(); }catch(e){} };
        try{ Wake.addListener&&Wake.addListener('wake',function(){ try{ onNativeWake(); }catch(e){} }); }catch(e){}
      }
      // ---- re-lock on resume + lock on launch ----
      if(P.App) P.App.addListener('appStateChange',function(s){ if(s&&s.isActive){ try{ maybeBioLock(); }catch(e){} } });
      try{ maybeBioLock(); }catch(e){}
    })();
    // Native background wake-word fired → start the same auto voice capture the Python wake listener uses.
    function onNativeWake(){ try{ if(typeof recording!=='undefined'&&recording) return; startRec(true); }catch(e){} }
    // Drop OS-shared text into the composer (called by the native bridge's share-in handler).
    function applyShareIn(text){ try{ if(!text)return; var v=E.input.value; E.input.value=(v?v+'\n':'')+String(text); E.input.dispatchEvent(new Event('input')); E.input.focus(); toast(t('tShareIn')); }catch(e){} }
    // Biometric lock overlay (native only). Shown when cfg.bioLock; cleared once the OS confirms identity.
    var bioOverlay=null;
    async function maybeBioLock(){ if(!(window.__jarvisNative&&window.__jarvisNative.unlock&&cfg.bioLock)) return; if(bioOverlay) return;
      bioOverlay=document.createElement('div'); bioOverlay.className='biolock';
      bioOverlay.innerHTML='<div class="biolock-in"><div style="font-size:44px">🔒</div><div style="margin:10px 0 16px">Jarvis bloqueado</div><button type="button" id="bioUnlockBtn" class="primary">Desbloquear</button></div>';
      document.body.appendChild(bioOverlay);
      var go=async function(){ if(await window.__jarvisNative.unlock()){ if(bioOverlay){ bioOverlay.remove(); bioOverlay=null; } } };
      var b=bioOverlay.querySelector('#bioUnlockBtn'); if(b) b.onclick=go; go();
    }
    let searchMode='literal', semanticSearchScope='project', searchTimer=null;
    function setSearchMode(m){ searchMode=m; E.smLiteral.classList.toggle('on',m==='literal'); E.smSemantic.classList.toggle('on',m==='semantic');
      E.semanticScope.classList.toggle('hidden',m!=='semantic');
      E.searchInput.placeholder=m==='semantic'?'Buscar por SIGNIFICADO (ex.: onde mexi no refresh de token)…':'Filtrar por título ou conteúdo… (ex.: a2p)'; E.searchResults.innerHTML=''; }
    E.smLiteral.onclick=()=>setSearchMode('literal'); E.smSemantic.onclick=()=>setSearchMode('semantic');
    function setSemanticScope(scope){ semanticSearchScope=scope==='all'?'all':'project'; E.memScopeProject.classList.toggle('on',semanticSearchScope==='project'); E.memScopeAll.classList.toggle('on',semanticSearchScope==='all'); E.searchResults.innerHTML=''; }
    E.memScopeProject.onclick=()=>setSemanticScope('project'); E.memScopeAll.onclick=()=>setSemanticScope('all');
    E.memReindex.onclick=()=>{ tx({t:'memory_reindex'}); toast(t('tMemReindexing')); };
    function openSearch(){ E.searchInput.value=''; setSearchMode('literal'); if(E.memReindex) E.memReindex.classList.toggle('hidden',!(authUser&&authUser.role==='owner')); E.searchModal.classList.remove('hidden'); closeSide(); setTimeout(()=>E.searchInput.focus(),30); }
    function runSearch(){ const q=E.searchInput.value.trim(); if(!q){ E.searchResults.innerHTML=''; return; }
      E.searchResults.innerHTML=searchMode==='semantic'?'<div class="mut">Buscando por significado (pode levar alguns segundos)…</div>':'<div class="mut">Buscando…</div>';
      tx(searchMode==='semantic'?{t:'memory_search',query:q,sessionId:currentSession,scope:semanticSearchScope}:{t:'search',query:q}); }
    E.searchGo.onclick=runSearch;
    E.searchClose.onclick=()=>E.searchModal.classList.add('hidden');
    E.searchInput.onkeydown=(e)=>{ if(e.key==='Enter'){ e.preventDefault(); clearTimeout(searchTimer); runSearch(); } };
    // filtra ao digitar (debounce) — a 1ª busca parseia as sessões nativas, refinar o termo é instantâneo
    E.searchInput.oninput=()=>{ clearTimeout(searchTimer); const q=E.searchInput.value.trim(); if(!q){ E.searchResults.innerHTML=''; return; } if(searchMode==='semantic') return; searchTimer=setTimeout(runSearch,300); };
    E.searchResults.addEventListener('click',(e)=>{
      const exec=e.target.closest('.exec'); if(exec){ e.stopPropagation(); if(exec.dataset.runner){ routedMachine=exec.dataset.runner; tx({t:'runner',runnerId:routedMachine}); } tx({t:'sendTo',sessionId:exec.dataset.id,text:exec.dataset.action,speak,model:curModel,effort:curEffort,auto:routeAutoFor(exec.dataset.id)}); openSession(exec.dataset.id,exec.dataset.runner); E.searchModal.classList.add('hidden'); return; }
      const match=e.target.closest('.match'); if(match){ if(match.dataset.runner){ routedMachine=match.dataset.runner; tx({t:'runner',runnerId:routedMachine}); } openSession(match.dataset.id,match.dataset.runner); E.searchModal.classList.add('hidden'); } });

    let memoryPreviewToken='', memoryApplyToken='', memoryPreviewNote='', memoryApplyNote='';
    function showMemoryPreview(m){ memoryPreviewToken=m.token||''; memoryApplyToken=''; memoryPreviewNote=m.note||''; memoryApplyNote=''; E.memoryTarget.textContent=m.target||'—'; E.memoryNote.textContent=m.appendText||m.note||'';
      E.memoryMeta.textContent=(m.mode==='jarvis'?'Privada para seu usuário':'Arquivo de instruções do projeto')+' · expira em 5 minutos'; E.memoryCancel.disabled=false; E.memoryApply.disabled=!memoryPreviewToken; E.memoryModal.classList.remove('hidden'); }
    E.memoryCancel.onclick=()=>{ if(!memoryPreviewToken)return; E.memoryCancel.disabled=true; tx({t:'memory_cancel',token:memoryPreviewToken}); };
    E.memoryApply.onclick=()=>{ if(!memoryPreviewToken)return; memoryApplyToken=memoryPreviewToken; memoryApplyNote=memoryPreviewNote; memoryPreviewToken=''; E.memoryCancel.disabled=true; E.memoryApply.disabled=true; tx({t:'memory_apply',token:memoryApplyToken}); };

    // ---------- footer popovers (pills clicáveis) ----------
    let popMode=null;
    function closePop(){ E.pop.classList.add('hidden'); E.pop.innerHTML=''; E.pop._anchor=null; popMode=null; }
    function openPop(anchor,build){ closePop(); build(E.pop); E.pop.classList.remove('hidden'); E.pop._anchor=anchor;
      const r=anchor.getBoundingClientRect(), pr=E.pop.getBoundingClientRect();
      const left=Math.max(8,Math.min(r.left, innerWidth-pr.width-8)); let top=r.top-pr.height-8; if(top<8) top=r.bottom+8;
      E.pop.style.left=left+'px'; E.pop.style.top=top+'px'; }
    function togglePop(anchor,build){ if(!E.pop.classList.contains('hidden') && E.pop._anchor===anchor) closePop(); else openPop(anchor,build); }
    document.addEventListener('click',(e)=>{ if(E.pop.classList.contains('hidden'))return; if(E.pop.contains(e.target)||(E.pop._anchor&&E.pop._anchor.contains(e.target)))return; closePop(); });
    document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') closePop(); });
    const ph=(t)=>{ const d=document.createElement('div'); d.className='ph'; d.textContent=t; return d; };

    function machineAgents(){ const id=currentMachine==='all'?routedMachine:currentMachine, m=machines.find(x=>x.id===id); return m&&Array.isArray(m.agents)?m.agents:caps.map(c=>c.name); }
    function buildAgentPop(p){ p.appendChild(ph('Agente / IA')); const avail=machineAgents(), pref=sessionValue(sessionPrefs,currentSession,currentSessionRunner)||{}, prefKey=sessionStateKey(currentSession,currentSessionRunner);
      if(!curStarted&&!curNative){ const a=document.createElement('div'); a.className='opt'+(pref.agent===AUTO_AGENT?' sel':''); a.innerHTML='✨ Automático'+(pref.agent===AUTO_AGENT?'<span class="r">atual</span>':''); a.onclick=()=>{ closePop(); const np=Object.assign({},pref,{agent:AUTO_AGENT,model:AUTO_MODEL,effort:AUTO_EFFORT}); sessionPrefs[prefKey]=np; saveSessionPrefs(); syncModelEffort(); }; p.appendChild(a); }
      machineCaps().forEach(c=>{ const ok=avail.includes(c.name); const o=document.createElement('div'); o.className='opt'+(c.name===currentAgent?' sel':'')+(ok?'':' disabled');
        const state=c.support==='limited'?'limitado':c.support==='unverified'?'não verificado':c.support==='unauthenticated'?'sem login':c.support==='not_installed'?'não instalado':''; o.title=c.reason||'';
        o.innerHTML='🤖 '+esc(c.label||c.name)+(c.name===currentAgent?'<span class="r">atual</span>':(!ok?'<span class="r">indisponível</span>':(state?'<span class="r">'+esc(state)+'</span>':'')));
        if(ok) o.onclick=()=>{ closePop(); const np=Object.assign({},pref,{agent:c.name}); sessionPrefs[prefKey]=np; saveSessionPrefs(); if(c.name!==currentAgent) tx({t:'configure',sessionId:currentSession,agent:c.name}); else renderControls(); };
        p.appendChild(o); }); }

    function buildModelPop(p){ const c=capsFor(currentAgent), control=modelControlOf(c), prefKey=sessionStateKey(currentSession,currentSessionRunner); p.appendChild(ph('Modelo')); if(control!=='per_turn'){ const n=document.createElement('div'); n.className='mut'; n.style.padding='10px'; n.textContent=control==='configuration_only'?'Este CLI define o modelo na própria configuração; o Jarvis não envia um modelo por turno.':'O provedor escolhe o modelo automaticamente.'; p.appendChild(n); return; } { const a=document.createElement('div'); a.className='opt'+(curModel==null?' sel':''); a.innerHTML='✨ Automático'+(curModel==null?'<span class="r">atual</span>':''); a.onclick=()=>{ closePop(); const pref=Object.assign({},sessionValue(sessionPrefs,currentSession,currentSessionRunner)||{}); pref.model=AUTO_MODEL; sessionPrefs[prefKey]=pref; saveSessionPrefs(); syncModelEffort(); }; p.appendChild(a); } selectableModels(c).forEach(mm=>{ const o=document.createElement('div'); o.className='opt'+(mm.id===curModel?' sel':'');
      o.innerHTML=esc(mm.label||mm.id)+(mm.id===curModel?'<span class="r">atual</span>':'');
      o.onclick=()=>{ closePop(); const pref=Object.assign({},sessionValue(sessionPrefs,currentSession,currentSessionRunner)||{}), efs=effortsFor(currentAgent,mm.id); pref.model=mm.id; if(pref.effort&&pref.effort!==AUTO_EFFORT&&!efs.includes(pref.effort))pref.effort=AUTO_EFFORT; sessionPrefs[prefKey]=pref; saveSessionPrefs(); syncModelEffort(); }; p.appendChild(o); }); }

    function buildEffortPop(p){ const efs=effortsFor(currentAgent,curModel); p.appendChild(ph('Esforço · '+(currentAgent||'')));
      if(!efs.length){ const d=document.createElement('div'); d.className='mut'; d.textContent='sem níveis para este modelo'; p.appendChild(d); return; }
      const saveEffort=(value)=>{ curEffort=value; const key=sessionStateKey(currentSession,currentSessionRunner), pref=Object.assign({},sessionValue(sessionPrefs,currentSession,currentSessionRunner)||{}); pref.effort=value==null?AUTO_EFFORT:value; sessionPrefs[key]=pref; saveSessionPrefs(); renderControls(); };
      // Automático is a routing mode, not a point below "Mínimo" on the effort scale.
      // Keep it separate so the slider remains a truthful low → high representation.
      const auto=document.createElement('button'); auto.type='button'; auto.className='opt effort-auto'+(curEffort==null?' sel':''); auto.setAttribute('aria-pressed',String(curEffort==null));
      auto.innerHTML='✨ Automático'+(curEffort==null?'<span class="r">atual</span>':''); auto.onclick=()=>{ closePop(); saveEffort(null); }; p.appendChild(auto);
      const modelDefault=(modelObj(currentAgent,curModel)||{}).defaultEffort;
      const initial=[curEffort,sessDeclEffort,modelDefault,efs[0]].find(e=>efs.includes(e));
      const idx=Math.max(0,efs.indexOf(initial));
      const manual=document.createElement('div'); manual.className='effort-manual'; manual.appendChild(ph('Manual'));
      if(efs.length===1){ const only=document.createElement('button'); only.type='button'; only.className='effort-single'+(curEffort===efs[0]?' sel':''); only.textContent=effLabel(efs[0]); only.setAttribute('aria-pressed',String(curEffort===efs[0])); only.onclick=()=>{ closePop(); saveEffort(efs[0]); }; manual.appendChild(only); p.appendChild(manual); return; }
      const labels=document.createElement('div'); labels.className='slbl'; const fast=document.createElement('span'), smart=document.createElement('span'); fast.textContent='Mais rápido'; smart.textContent='Mais inteligente'; labels.append(fast,smart); manual.appendChild(labels);
      const range=document.createElement('input'); range.type='range'; range.className='effort-range'; range.min='0'; range.max=String(efs.length-1); range.step='1'; range.value=String(idx); range.setAttribute('aria-label','Nível de esforço');
      const value=document.createElement('div'); value.className='sval'; value.setAttribute('aria-live','polite');
      const preview=()=>{ const selected=efs[Number(range.value)]||efs[0]; const label=effLabel(selected); value.textContent=label; range.setAttribute('aria-valuetext',label); };
      preview(); range.oninput=preview; range.onchange=()=>{ const selected=efs[Number(range.value)]||efs[0]; auto.classList.remove('sel'); auto.setAttribute('aria-pressed','false'); auto.textContent='✨ Automático'; saveEffort(selected); range.setAttribute('aria-valuetext',effLabel(selected)); };
      manual.append(range,value); p.appendChild(manual); }

    function buildFolderBrowser(p,{runnerId='local',initial='',onUse,showRecents=false}={}){ popMode='folder'; browseRunner=runnerId; browseUse=onUse||null; p.appendChild(ph('Pasta de trabalho'));
      if(showRecents&&recentDirs.length){ p.appendChild(ph('Recentes')); const rl=document.createElement('div'); rl.className='flist'; rl.style.maxHeight='140px'; rl.style.marginBottom='8px';
        recentDirs.forEach(d=>{ const it=document.createElement('div'); it.textContent='🕘 '+base(d); it.title=d; it.onclick=()=>{ closePop(); tx({t:'configure',sessionId:currentSession,cwd:d}); }; rl.appendChild(it); }); p.appendChild(rl); p.appendChild(ph('Navegar')); }
      const path=document.createElement('div'); path.className='fpath'; path.id='popPath'; path.textContent='carregando…'; p.appendChild(path);
      const list=document.createElement('div'); list.className='flist'; list.id='popList'; list.style.height='190px'; p.appendChild(list);
      const row=document.createElement('div'); row.className='frow';
      const up=document.createElement('button'); up.className='ghost'; up.id='popUp'; up.textContent='⬆ acima'; up.onclick=()=>tx({t:'listdir',runnerId:browseRunner,path:up.dataset.parent||''});
      const use=document.createElement('button'); use.id='popUse'; use.textContent='Usar esta pasta'; use.onclick=()=>{ const b=browsePath, fn=browseUse; closePop(); if(fn)fn(b); };
      row.appendChild(up); row.appendChild(use); p.appendChild(row);
      tx({t:'listdir',runnerId:browseRunner,path:initial||''}); }
    function buildFolderPop(p){ buildFolderBrowser(p,{runnerId:routedMachine||'local',initial:curCwd||cfg.lastCwd||'',showRecents:true,onUse:b=>tx({t:'configure',sessionId:currentSession,cwd:b})}); }

    E.agentBtn.onclick=()=>{ if(curStarted||curNative)return; togglePop(E.agentBtn,buildAgentPop); };
    E.cwdBtn.onclick=()=>{ if(curStarted||curNative)return; togglePop(E.cwdBtn,buildFolderPop); };
    E.modelBtn.onclick=()=>togglePop(E.modelBtn,buildModelPop);
    E.effortBtn.onclick=()=>togglePop(E.effortBtn,buildEffortPop);
    // ---- usage indicator: context window (per turn) + plan limits (5h/weekly) ----
    let lastInputTokens=0, lastContextWindow=0, planUsage=null, planStatus=null, planKey='', sessCost=0, sessUsage=null, costTotalAll=0;
    // Custo da sessão como PARCELA do total acumulado — um $ isolado (ainda mais num plano, onde é só
    // um equivalente-API, não dinheiro real) não dá pra comparar; % do total dá.
    function sessCostRow(){
      if(!(sessCost>0)) return '<div class="umut">sem custo ainda nesta sessão</div>';
      const pct=costTotalAll>0?Math.round(sessCost/costTotalAll*100):null;
      const p=sessUsage&&sessUsage.billableUsd>0&&sessUsage.estimatedUsd<=0?'$':sessUsage&&sessUsage.estimatedUsd>0&&sessUsage.billableUsd<=0?'≈$':'Σ$';
      return `<div class="urow"><span>esta sessão${pct!=null?` · ${pct}% do total`:''}</span><b>${p}${sessCost.toFixed(4)}</b></div>`
        +(costTotalAll>0?`<div class="umut ureset">total acumulado (todas as sessões): Σ$${costTotalAll.toFixed(2)} · classes separadas em Uso & custo</div>`:'');
    }
    function modelContext(){ return lastContextWindow||((modelObj(currentAgent,curModel||sessDeclModel)||{}).context||0); }
    function ctxPct(){ const c=modelContext(); return c?Math.min(100,Math.round(lastInputTokens/c*100)):0; }
    function updUsagePill(){ if(!E.usageName)return; E.usageName.textContent=(modelContext()&&lastInputTokens)?ctxPct()+'%':'—'; }
    const kfmt=n=>n>=1e6?(n/1e6).toFixed(n%1e6?1:0)+'M':n>=1e3?Math.round(n/1e3)+'k':String(n||0);
    function fmtReset(iso){ if(!iso)return''; const d=new Date(iso),now=new Date(),mins=Math.round((d-now)/60000);
      if(mins<=0)return'já'; if(mins<60)return`em ${mins}min`; const h=Math.floor(mins/60),m=mins%60;
      if(h<24)return`em ${h}h${m?(' '+m+'min'):''}`; const dd=['dom','seg','ter','qua','qui','sex','sáb']; return `${dd[d.getDay()]}, ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
    const ubar=(pct,color)=>`<div class="ubar"><span style="width:${Math.min(100,pct||0)}%;background:${color}"></span></div>`;
    function buildUsagePop(p){ popMode='usage'; const c=modelContext();
      let h='<div class="upop"><div class="uh">Janela de contexto</div>';
      if(c&&lastInputTokens){ const pc=ctxPct(); h+=`<div class="urow"><span>${kfmt(lastInputTokens)} / ${kfmt(c)}</span><b>${pc}%</b></div>`+ubar(pc, pc>85?'#f85149':pc>60?'#e3b341':'#3fb950'); }
      else h+='<div class="umut">envie uma mensagem para medir</div>';
      h+='<div class="uh" style="margin-top:12px">Custo da sessão</div><div id="usessc">'+sessCostRow()+'</div>';
      h+='<div class="uh" style="margin-top:12px">Limites do plano</div><div id="uplan" class="umut">carregando…</div></div>';
      const usageRunner=currentMachine==='all'?routedMachine:currentMachine, usageAgent=currentAgent||availableMachineCaps()[0]?.name||caps[0]?.name||'';
      p.innerHTML=h; if(planKey===usageRunner+'\0'+usageAgent) renderPlan(planUsage); tx({t:'get_usage',agent:usageAgent,runnerId:usageRunner}); }
    function renderPlan(plan){ const el=document.getElementById('uplan'); if(!el)return;
      if(!plan){ el.className='umut'; el.textContent=planStatus==='unsupported'?'o CLI desta IA não publica limites de conta':planStatus==='error'?'erro ao consultar o provedor':'nenhum limite foi reportado pelo provedor'; return; }
      const w=(lbl,x,color)=> x?`<div class="urow"><span>${esc(lbl)}</span><b>${planPctText(x)}</b></div>`+ubar(planUsed(x),color)+(x.resetsAt?`<div class="umut ureset">reinicia ${fmtReset(x.resetsAt)}</div>`:''):'';
      let h=w('Limite de 5 horas',plan.fiveHour,'#2563eb')+w('Semanal · todos os modelos',plan.sevenDay,'#7c3aed');
      (plan.extra||[]).forEach(e=>h+=w(e.label,e,'#7c3aed'));
      if(plan.source) h+=`<div class="umut">fonte: ${esc(plan.source)}</div>`;
      el.className=''; el.innerHTML=h||'<span class="umut">sem dados</span>'; }
    E.usageBtn.onclick=()=>togglePop(E.usageBtn,buildUsagePop);

    // ---------- settings (persistente) ----------
    E.settingsBtn.onclick=()=>{ E.settings.classList.remove('hidden'); const mc=availableMachineCaps(); fillSel(E.setAgent,mc.map(c=>({id:c.name,label:c.label||c.name})),cfg.agent||currentAgent); const c=mc.find(x=>x.name===E.setAgent.value)||capsFor(E.setAgent.value);
      const sm=selectableModels(c), defaultModel=(sm.some(m=>m.id===cfg.model)&&cfg.model)||(sm.some(m=>m.id===c.defaultModel)&&c.defaultModel)||(sm[0]||{}).id||'';
      fillSel(E.setModel,modelControlOf(c)==='per_turn'?sm:[],defaultModel); fillEfforts(E.setEffort,E.setAgent.value,E.setModel.value,cfg.effort);
      E.setVoice.checked=cfg.voice; E.setContinue.checked=cfg.continue; E.setContinueSec.value=cfg.continueSec; E.setWake.checked=cfg.wake; E.setNoise.checked=cfg.noise; if(E.setSlash)E.setSlash.checked=(cfg.slashMenu!==false); E.setPush.checked=!!cfg.push; if(E.setBioLock)E.setBioLock.checked=!!cfg.bioLock; E.pushDone.checked=(cfg.pushEvents||[]).includes('done'); E.pushError.checked=(cfg.pushEvents||[]).includes('error'); E.pushMachine.checked=(cfg.pushEvents||[]).includes('machine'); E.pushMode.value=cfg.pushMode||'each'; E.pushEvery.value=cfg.pushEvery||15; renderPushCfg(); E.setGate.checked=cfg.voiceGate; renderSpk(); tx({t:'speakers'});
      fillSumSelects(); tx({t:'summary_cfg'});
      renderUpdate(); E.updStatus.textContent='Verificando…'; tx({t:'update_check'});
      const isOwner=authUser&&authUser.role==='owner'; E.routinesSection.classList.toggle('hidden',!isOwner); E.executionSettings.classList.toggle('hidden',!isOwner); if(E.policySettings)E.policySettings.classList.toggle('hidden',!isOwner); if(isOwner){ fillRoutineMachines(); validateRoutineCron(); tx({t:'routines'}); tx({t:'execution_cfg'}); tx({t:'policy_state',sessionId:currentSession}); }
      tx({t:'voice_cfg'}); if(E.setLang) E.setLang.value=lang; };
    if(E.setLang) E.setLang.onchange=()=>setLang(E.setLang.value);
    E.setAgent.onchange=()=>{ const c=capsFor(E.setAgent.value), ms=selectableModels(c), model=(ms.some(m=>m.id===c.defaultModel)&&c.defaultModel)||(ms[0]||{}).id||''; fillSel(E.setModel,modelControlOf(c)==='per_turn'?ms:[],model); fillEfforts(E.setEffort,E.setAgent.value,E.setModel.value); };
    // ---------- rotinas agendadas (owner) ----------
    function renderRoutines(list){ if(!E.routinesList)return;
      if(!list||!list.length){ E.routinesList.textContent='Nenhuma rotina ainda.'; return; }
      E.routinesList.innerHTML='';
      list.forEach(r=>{ const d=document.createElement('div'); d.style.cssText='display:flex;align-items:center;gap:4px;padding:3px 0';
        const machine=(machines.find(m=>m.id===(r.runnerId||'local'))||{}).label||r.runnerId||'servidor';
        d.innerHTML=`<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.enabled?'':'⏸ '}<b>${esc(r.name)}</b> <span class="mut">· ${esc(r.label||'')} · ${esc(machine)} · ${esc(r.auto&&r.auto.agent?'IA automática':(r.agent||'padrão'))} · ${esc(r.auto&&r.auto.model?'modelo automático':(r.model||'padrão'))} · ${esc(r.auto&&r.auto.effort?'esforço automático':(r.effort?effLabel(r.effort):'padrão'))}</span>${r.speak?' 🔊':''}</span>`;
        const mk=(txt,title,fn)=>{ const b=document.createElement('button'); b.className='ghost'; b.textContent=txt; b.title=title; b.style.cssText='padding:2px 7px;flex:none'; b.onclick=fn; return b; };
        d.appendChild(mk('↻','Rodar agora',()=>{ tx({t:'routine_run',id:r.id}); toast('Rodando “'+r.name+'”…'); }));
        d.appendChild(mk(r.enabled?'⏸':'▶️', r.enabled?'Pausar':'Ativar', ()=>tx({t:'routine_update',id:r.id,patch:{enabled:!r.enabled}})));
        d.appendChild(mk('🗑','Remover',async()=>{ if(await dialog({title:`Remover a rotina "${r.name}"?`,okText:'Remover',danger:true})) tx({t:'routine_del',id:r.id}); }));
        E.routinesList.appendChild(d); }); }
    let cronOk=false, cronTimer=null, routineTimezone='local do Hub';
    function validateRoutineCron(){ clearTimeout(cronTimer); cronOk=false; E.rtAdd.disabled=true; E.rtCronHelp.className='cron-help mut'; E.rtCronHelp.textContent='Validando…'; cronTimer=setTimeout(()=>tx({t:'routine_validate',cron:(E.rtCron.value||'').trim()}),180); }
    E.rtAdd.onclick=()=>{ const name=(E.rtName.value||'').trim(), prompt=(E.rtPrompt.value||'').trim(), cron=(E.rtCron.value||'').trim(); if(!name||!prompt){ toast(t('tRtFill')); return; } if(!cronOk){ toast('Corrija a agenda cron antes de adicionar.'); validateRoutineCron(); return; }
      tx({t:'routine_add',routine:{name,prompt,cron,hour:0,minute:0,runnerId:E.rtRunner.value||'local',agent:E.rtAgent.value||undefined,model:E.rtModel.value||undefined,effort:E.rtEffort.value||undefined,auto:{agent:!E.rtAgent.value,model:!E.rtModel.value,effort:!E.rtEffort.value},cwd:(E.rtCwd.value||'').trim()||undefined,speak:E.rtSpeak.checked}}); E.rtName.value=''; E.rtPrompt.value=''; E.rtCwd.value=''; E.rtSpeak.checked=false; };
    function fillRoutineChoice(sel,items,val,emptyLabel){ fillSel(sel,items,val); if(!items.length){ const o=document.createElement('option'); o.value=''; o.textContent=emptyLabel; sel.appendChild(o); sel.classList.remove('hidden'); sel.disabled=true; } else sel.disabled=false; }
    function fillRoutineMachines(){ const desired=E.rtRunner.value||(currentMachine==='all'?routedMachine:currentMachine), preferred=machines.some(m=>m.id===desired)?desired:(machines.some(m=>m.id==='local')?'local':(machines[0]||{}).id); fillSel(E.rtRunner,machines.map(m=>({id:m.id,label:(m.label||m.id)+(m.online?'':' · offline')})),preferred); fillRoutineAgents(); }
    function fillRoutineEfforts(){ const c=routineCapsFor(E.rtAgent.value), m=(c.models||[]).find(x=>x.id===E.rtModel.value), efs=m?(m.efforts||[]):[...new Set((c.models||[]).flatMap(x=>x.efforts||[]))], old=E.rtEffort.value, items=efs.length?[{id:'',label:'Automático'},...efs.map(id=>({id,label:effLabel(id)}))]:[], effort=old===''?'':(efs.includes(old)?old:''); fillRoutineChoice(E.rtEffort,items,effort,'Automático / não aplicável'); }
    function fillRoutineModels(){ if(!E.rtAgent.value){ fillRoutineChoice(E.rtModel,[{id:'',label:'Automático'}],'','Automático'); fillRoutineChoice(E.rtEffort,[{id:'',label:'Automático'}],'','Automático'); return; } const c=routineCapsFor(E.rtAgent.value), control=modelControlOf(c), ms=(c.models||[]).filter(m=>m.selectable!==false), old=E.rtModel.value, selectable=control==='per_turn'?([{id:'',label:'Automático'}].concat(ms)):[], model=selectable.some(m=>m.id===old)?old:''; fillRoutineChoice(E.rtModel,selectable,model,control==='configuration_only'?'Configurado na IA':'Automático'); fillRoutineEfforts(); }
    function fillRoutineAgents(){ const cs=routineCaps(), old=E.rtAgent.value, preferred=old===''?'':(cs.some(c=>c.name===old)?old:''); fillRoutineChoice(E.rtAgent,[{id:'',label:'Automático'},...cs.map(c=>({id:c.name,label:c.label||c.name}))],preferred,'Nenhuma IA disponível'); fillRoutineModels(); }
    E.rtRunner.onchange=()=>{ E.rtCwd.value=''; fillRoutineAgents(); };
    E.rtAgent.onchange=fillRoutineModels;
    E.rtModel.onchange=fillRoutineEfforts;
    E.rtBrowse.onclick=()=>togglePop(E.rtBrowse,p=>buildFolderBrowser(p,{runnerId:E.rtRunner.value||'local',initial:E.rtCwd.value||'',onUse:b=>{ E.rtCwd.value=b; }}));
    E.rtCron.oninput=validateRoutineCron;
    E.rtCronExamples.onclick=e=>{ const b=e.target.closest('[data-cron]'); if(!b)return; E.rtCron.value=b.dataset.cron; validateRoutineCron(); };
    // ---------- config do refino por voz (escalada de modelo) ----------
    let currentVoiceCfg={};
    function fillVoiceModels(cfg){ const c=localCapsFor(E.setVoiceAgent.value), models=selectableModels(c); fillSel(E.setVoiceModel,models,(cfg&&cfg.model)||c.defaultModel||(models[0]||{}).id||''); const m=models.find(x=>x.id===E.setVoiceModel.value); fillSel(E.setVoiceEffort,(m&&m.efforts)||[],(cfg&&cfg.effort)||(m&&m.defaultEffort)||''); }
    function saveVoiceModelCfg(){ tx({t:'set_voice_cfg',agent:E.setVoiceAgent.value,model:E.setVoiceModel.value,effort:E.setVoiceEffort.value}); }
    function renderVoiceCfg(cfg){ if(!E.setVoiceEscalate)return; currentVoiceCfg=cfg||{}; const local=machines.find(m=>m.id==='local'), names=local&&Array.isArray(local.agents)?local.agents:caps.map(c=>c.name), available=caps.filter(c=>names.includes(c.name)); fillSel(E.setVoiceAgent,available.map(c=>({id:c.name,label:c.label||c.name})),cfg.agent||currentAgent); fillVoiceModels(cfg); const models=(localCapsFor(E.setVoiceAgent.value).models||[]).map(x=>x.id);
      const opts=[['ask','Sempre perguntar'],['auto','Automático (deixar decidir)']].concat(models.map(m=>[m,'Sempre: '+m]));
      E.setVoiceEscalate.innerHTML=''; opts.forEach(([v,l])=>{ const o=document.createElement('option'); o.value=v; o.textContent=l; if(v===((cfg&&cfg.escalate)||'ask')) o.selected=true; E.setVoiceEscalate.appendChild(o); });
      if(E.setVoiceRelevance) E.setVoiceRelevance.checked=((cfg&&cfg.relevance)||'on')!=='off'; }
    E.setVoiceEscalate.onchange=()=>tx({t:'set_voice_cfg',escalate:E.setVoiceEscalate.value});
    E.setVoiceAgent.onchange=()=>{ fillVoiceModels({}); saveVoiceModelCfg(); };
    E.setVoiceModel.onchange=()=>{ fillVoiceModels({model:E.setVoiceModel.value}); saveVoiceModelCfg(); };
    E.setVoiceEffort.onchange=saveVoiceModelCfg;
    if(E.setVoiceRelevance) E.setVoiceRelevance.onchange=()=>tx({t:'set_voice_cfg',relevance:E.setVoiceRelevance.checked?'on':'off'});
    E.setModel.onchange=()=>fillEfforts(E.setEffort,E.setAgent.value,E.setModel.value);
    // resumo/digest one-shot config (roda no Hub; barato por padrão)
    let sumCfg={agent:'claude-code',model:'haiku',effort:'low'};
    function fillSumSelects(){ if(!E.setSumAgent||!caps.length)return; const local=machines.find(m=>m.id==='local'), names=local&&Array.isArray(local.agents)?local.agents:caps.map(c=>c.name), available=caps.filter(c=>names.includes(c.name)); fillSel(E.setSumAgent,available.map(c=>({id:c.name,label:c.label||c.name})),available.some(c=>c.name===sumCfg.agent)?sumCfg.agent:(available[0]||{}).name); const c=localCapsFor(E.setSumAgent.value); fillSel(E.setSumModel,c.models,sumCfg.model); const m=(c.models||[]).find(x=>x.id===E.setSumModel.value); fillSel(E.setSumEffort,(m&&m.efforts)||[],sumCfg.effort); }
    function saveSum(){ tx({t:'set_summary_cfg',agent:E.setSumAgent.value,model:E.setSumModel.value,effort:E.setSumEffort.value}); }
    E.setSumAgent.onchange=()=>{ const c=localCapsFor(E.setSumAgent.value); fillSel(E.setSumModel,c.models,c.defaultModel); const m=(c.models||[]).find(x=>x.id===E.setSumModel.value); fillSel(E.setSumEffort,(m&&m.efforts)||[],m&&m.defaultEffort); saveSum(); };
    E.setSumModel.onchange=()=>{ fillEfforts(E.setSumEffort,E.setSumAgent.value,E.setSumModel.value); saveSum(); };
    E.setSumEffort.onchange=saveSum;
    let adaptivePolicyDoc=null;
    let adaptiveApprovalEl=null;
    function renderAdaptiveApprovals(items){
      const rows=Array.isArray(items)?items:[];
      if(!rows.length){ if(adaptiveApprovalEl){ adaptiveApprovalEl.remove(); adaptiveApprovalEl=null; } return; }
      if(!adaptiveApprovalEl){ adaptiveApprovalEl=document.createElement('div'); adaptiveApprovalEl.className='toast'; adaptiveApprovalEl.style.cssText='right:14px;left:auto;bottom:82px;max-width:min(420px,calc(100vw - 28px));display:flex;flex-direction:column;gap:8px;align-items:stretch'; document.body.appendChild(adaptiveApprovalEl); }
      adaptiveApprovalEl.innerHTML='<b>Precisa de aprovação</b>';
      rows.slice(0,5).forEach(a=>{
        const row=document.createElement('div'); row.style.cssText='display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;border-top:1px solid #ffffff24;padding-top:7px';
        const txt=document.createElement('div'); txt.innerHTML='<div style="font-weight:600">'+esc(a.title||'Ação pendente')+'</div><div style="font-size:11.5px;opacity:.8">'+esc(a.reason||'policy_requires_approval')+'</div>'; row.appendChild(txt);
        const acts=document.createElement('div'); acts.style.cssText='display:flex;gap:6px';
        const no=document.createElement('button'); no.type='button'; no.className='ghost'; no.textContent='Rejeitar'; no.onclick=()=>tx({t:'adaptive_approval',id:a.id,action:'reject'});
        const yes=document.createElement('button'); yes.type='button'; yes.textContent='Aprovar'; yes.onclick=()=>tx({t:'adaptive_approval',id:a.id,action:'approve'});
        acts.appendChild(no); acts.appendChild(yes); row.appendChild(acts); adaptiveApprovalEl.appendChild(row);
      });
    }
    function applyPolicyModePreset(mode){ const p=mode==='manual'?{risk:'low',auto:false,bg:false}:mode==='controlled_autonomy'?{risk:'high',auto:true,bg:true}:{risk:'medium',auto:false,bg:false};
      E.setPolicyRisk.value=p.risk; E.setPolicyAutoplay.checked=p.auto; E.setPolicyBackground.checked=p.bg; }
    if(E.setPolicyMode) E.setPolicyMode.onchange=()=>applyPolicyModePreset(E.setPolicyMode.value);
    function renderAdaptivePolicy(m){ adaptivePolicyDoc=m.doc||adaptivePolicyDoc||{}; const g=adaptivePolicyDoc.global||{}, mem=g.memory||{}, au=g.autonomy||{}, bu=g.budget||{}, wr=g.write||{}, eff=(m.effective&&m.effective.policy)||g, chain=(m.effective&&m.effective.chain)||[], exp=(m.effective&&m.effective.explanation)||{};
      E.setPolicyMode.value=au.mode||'assisted'; E.setPolicyMemoryTarget.value=mem.writeTarget||'jarvis_only'; E.setPolicyRisk.value=au.requireApprovalAboveRisk||'medium'; E.setPolicyUnknown.value=bu.unknownEstimate||'ask';
      E.setPolicyCost.value=bu.maxCostUsd==null?'':bu.maxCostUsd; E.setPolicyTokens.value=bu.maxTokens==null?'':bu.maxTokens;
      E.setPolicyRepoWrites.checked=!!(wr.allowRepoWrites); E.setPolicyDiff.checked=wr.requireDiffPreview!==false; E.setPolicyAutoplay.checked=!!au.allowQueueAutoplay; E.setPolicyBackground.checked=!!au.allowBackgroundTurns;
      E.setPolicyOverrides.value=JSON.stringify({projects:adaptivePolicyDoc.projects||[],sessions:adaptivePolicyDoc.sessions||[],tasks:adaptivePolicyDoc.tasks||[]},null,2);
      const effBits=[eff.scope||'global',eff.label||'Global'].filter(Boolean).join(' · '), chainTxt=chain.length?chain.map(x=>x.label||x.id).join(' > '):'Global';
      const lbl={allow:'permitido',ask:'aprovação',reject:'bloqueado'}, ic={allow:'✓',ask:'?',reject:'×'}, bg={allow:'#22c55e1f',ask:'#f59e0b22',reject:'#ef444422'}, br={allow:'#22c55e55',ask:'#f59e0b66',reject:'#ef444466'};
      const controls=Array.isArray(exp.controls)?exp.controls:[];
      const chips=controls.map(c=>'<span title="'+esc(c.reason||'')+'" style="display:inline-flex;align-items:center;gap:4px;border:1px solid '+(br[c.state]||'#ffffff24')+';background:'+(bg[c.state]||'#ffffff12')+';border-radius:999px;padding:2px 7px;margin:2px 4px 2px 0">'+(ic[c.state]||'•')+' '+esc(c.label||c.key)+': '+esc(lbl[c.state]||c.state)+'</span>').join('');
      const warnings=Array.isArray(exp.warnings)&&exp.warnings.length?'<div style="color:#fcd34d;margin-top:4px">'+esc(exp.warnings.join(' · '))+'</div>':'';
      E.policyNote.innerHTML=(m.saved?'✓ Política salva. ':'')+'Efetiva agora: '+esc(effBits)+' · cadeia: '+esc(chainTxt)+(chips?'<div style="margin-top:6px">'+chips+'</div>':'')+warnings; }
    function collectAdaptivePolicy(){ if(!adaptivePolicyDoc)return null; let extra; try{ extra=JSON.parse(E.setPolicyOverrides.value||'{}'); }catch(e){ toast('JSON de políticas avançadas inválido.'); E.setPolicyOverrides.focus(); return null; }
      const global=Object.assign({},adaptivePolicyDoc.global||{}); global.memory=Object.assign({},global.memory||{}, {writeTarget:E.setPolicyMemoryTarget.value}); global.autonomy=Object.assign({},global.autonomy||{}, {mode:E.setPolicyMode.value,requireApprovalAboveRisk:E.setPolicyRisk.value,allowQueueAutoplay:E.setPolicyAutoplay.checked,allowBackgroundTurns:E.setPolicyBackground.checked}); global.budget=Object.assign({},global.budget||{}, {unknownEstimate:E.setPolicyUnknown.value}); global.write=Object.assign({},global.write||{}, {allowRepoWrites:E.setPolicyRepoWrites.checked,requireDiffPreview:E.setPolicyDiff.checked}); global.updatedAt=Date.now();
      if(E.setPolicyCost.value.trim()==='') delete global.budget.maxCostUsd; else global.budget.maxCostUsd=Number(E.setPolicyCost.value);
      if(E.setPolicyTokens.value.trim()==='') delete global.budget.maxTokens; else global.budget.maxTokens=Number(E.setPolicyTokens.value);
      return {schemaVersion:1,global,projects:Array.isArray(extra.projects)?extra.projects:[],sessions:Array.isArray(extra.sessions)?extra.sessions:[],tasks:Array.isArray(extra.tasks)?extra.tasks:[]}; }
    function policyFromVisibleControls(scope){ const now=Date.now(), mem=(adaptivePolicyDoc&&adaptivePolicyDoc.global&&adaptivePolicyDoc.global.memory)||{}, base={schemaVersion:1,scope,id:scope+'-'+now,label:scope==='project'?'Pasta atual':'Sessão atual',memory:Object.assign({},mem,{writeTarget:E.setPolicyMemoryTarget.value}),autonomy:{mode:E.setPolicyMode.value,requireApprovalAboveRisk:E.setPolicyRisk.value,allowQueueAutoplay:E.setPolicyAutoplay.checked,allowBackgroundTurns:E.setPolicyBackground.checked},budget:{unknownEstimate:E.setPolicyUnknown.value},write:{allowRepoWrites:E.setPolicyRepoWrites.checked,requireDiffPreview:E.setPolicyDiff.checked},updatedAt:now};
      if(E.setPolicyCost.value.trim()!=='') base.budget.maxCostUsd=Number(E.setPolicyCost.value); if(E.setPolicyTokens.value.trim()!=='') base.budget.maxTokens=Number(E.setPolicyTokens.value);
      if(scope==='project'){ base.id='project-'+String(curCwd||'').replace(/[^a-z0-9]+/gi,'-').slice(-80); base.label='Projeto: '+(curCwd||'pasta atual'); base.projectRoot=curCwd; }
      if(scope==='session'){ base.id='session-'+currentSession; base.label='Sessão: '+(E.title.textContent||currentSession||'atual'); base.sessionId=currentSession; }
      return base; }
    if(E.setPolicyProject) E.setPolicyProject.onclick=()=>{ if(!curCwd){ toast('Abra uma sessão com pasta de trabalho antes.'); return; } tx({t:'set_adaptive_policy_scope',policy:policyFromVisibleControls('project'),sessionId:currentSession}); };
    if(E.setPolicySession) E.setPolicySession.onclick=()=>{ if(!currentSession){ toast('Abra uma sessão antes.'); return; } tx({t:'set_adaptive_policy_scope',policy:policyFromVisibleControls('session'),sessionId:currentSession}); };
    // ---- atualização do sistema (git) ----
    let updState=null;
    // Uma maquina responde quando responde (pode estar ocupada, ou reiniciando). Guardamos por
    // runnerId e desenhamos conforme chega, em vez de fingir sucesso no envio.
    let updMach = {};
    function renderUpdMachines(){ if(!E.updMachines)return; const ids=Object.keys(updMach); E.updMachines.innerHTML='';
      for(const id of ids){ const m=updMach[id]; const d=document.createElement('div');
        d.className='updm '+(m.state==='ok'||m.state==='verified'?'ok':m.state==='fail'||m.state==='blocked'?'fail':'wait');
        const icon=m.state==='ok'||m.state==='verified'?'✓':m.state==='fail'||m.state==='blocked'?'✗':m.state==='queued'?'◷':'⏳';
        d.innerHTML='<span>'+icon+'</span><span class="nm">'+esc(m.label||id)+'</span>'+(m.why?'<span class="why">'+esc(m.why)+'</span>':'');
        // Forçar so aparece quando o motivo E repo sujo — e descarta o trabalho local daquela maquina.
        if((m.state==='fail'||m.state==='blocked')&&m.dirty){ const b=document.createElement('button'); b.type='button'; b.textContent='forçar';
          b.title='Descarta as alterações locais dessa máquina (git reset --hard) e pega a última versão';
          b.onclick=()=>{ if(!confirm('Descartar alterações locais em "'+(m.label||id)+'" e atualizar? Isso APAGA o que não estiver commitado NAQUELA máquina.'))return;
            updMach[id]={...m,state:'wait',why:'forçando…',dirty:false}; renderUpdMachines(); tx({t:'update_apply',runnerId:id,force:true}); };
          d.appendChild(b); }
        E.updMachines.appendChild(d); } }
    function renderUpdate(){ if(!E.updStatus)return; const s=updState; const owner=authUser&&authUser.role==='owner';
      if(!s){ E.updStatus.textContent='—'; E.updActions.classList.add('hidden'); return; }
      if(s.error||s.supported===false){ E.updStatus.textContent='ℹ '+(s.error||'auto-update indisponível (instale via git clone)'); E.updActions.classList.add('hidden'); return; }
      if((s.behind||0)>0){ const l=s.latest||{}; E.updStatus.innerHTML='🔄 <b>Nova versão</b> ('+s.behind+' commit'+(s.behind>1?'s':'')+'): '+esc((l.subject||'').slice(0,80));
        E.updActions.classList.toggle('hidden',!owner); if(!owner) E.updStatus.innerHTML+=' <span style="opacity:.6">(peça ao dono para atualizar)</span>'; }
      else { const need=machines.filter(m=>!m.local&&(m.stale||m.updatePending)); E.updStatus.textContent='✓ Hub na última versão ('+(s.current||'')+')'+(need.length?' · '+need.length+' máquina(s) aguardando atualização':''); E.updActions.classList.toggle('hidden',!(owner&&need.length)); if(owner&&need.length)E.updAll.checked=true; } }
    // reagem na hora: sem isso o usuario marca "agrupar" e nao ve onde escolher o intervalo
    if(E.setPush) E.setPush.onchange=renderPushCfg;
    if(E.pushMode) E.pushMode.onchange=renderPushCfg;
    E.updCheck.onclick=()=>{ E.updStatus.textContent='Verificando…'; tx({t:'update_check'}); };
    let updArmed=0;
    E.updApply.onclick=()=>{ const now=Date.now(); if(now-updArmed<4000){ updArmed=0; E.updApply.textContent='Atualizar'; E.updStatus.textContent='Atualizando… (o Hub vai reiniciar)'; E.updActions.classList.add('hidden'); tx({t:'update_apply',allMachines:E.updAll.checked}); }
      else { updArmed=now; E.updApply.textContent='Confirmar?'; setTimeout(()=>{ if(Date.now()-updArmed>=4000) E.updApply.textContent='Atualizar'; },4200); } };
    E.setEnroll.onclick=()=>enrollFlow();
    E.setClose.onclick=()=>{
      const isOwner=authUser&&authUser.role==='owner';
      if(isOwner){ const numeric=[E.setExecRetention,E.setExecMaxEvents,E.setExecConcurrency,E.setExecDepth]; if(adaptivePolicyDoc) numeric.push(E.setPolicyCost,E.setPolicyTokens); const invalid=numeric.find(x=>!x.checkValidity()); if(invalid){ invalid.reportValidity(); return; }
        tx({t:'set_execution_cfg',enabled:E.setExecEnabled.checked,retentionDays:+E.setExecRetention.value,maxEvents:+E.setExecMaxEvents.value,maxConcurrency:+E.setExecConcurrency.value,maxDepth:+E.setExecDepth.value,defaultWrite:E.setExecDefaultWrite.checked,worktreeRoot:(E.setExecWorktree.value||'').trim()}); }
      if(isOwner&&adaptivePolicyDoc){ const doc=collectAdaptivePolicy(); if(!doc)return; tx({t:'set_adaptive_policy',doc,sessionId:currentSession}); }
      if(E.setGate.checked && !speakers.length){ addErr('Cadastre sua voz antes de exigir voz cadastrada (senão o modo voz fica bloqueado).'); E.setGate.checked=false; }
      Object.assign(cfg,{agent:E.setAgent.value,model:E.setModel.value,effort:E.setEffort.value,voice:E.setVoice.checked,
      continue:E.setContinue.checked,continueSec:+E.setContinueSec.value||30,wake:E.setWake.checked,noise:E.setNoise.checked,voiceGate:E.setGate.checked,bioLock:!!(E.setBioLock&&E.setBioLock.checked),slashMenu:!E.setSlash||E.setSlash.checked});
      if(!slashOn()) closeTrig();
      saveCfg(); speak=cfg.voice; setSpeakBtn(); tx({t:'wake',enabled:cfg.wake}); tx({t:'voicecfg',gate:cfg.voiceGate});
      if(window.__jarvisNative){ if(cfg.wake){ window.__jarvisNative.wakeStart&&window.__jarvisNative.wakeStart(); } else { window.__jarvisNative.wakeStop&&window.__jarvisNative.wakeStop(); } }
      const pp=pushPrefs(); cfg.pushEvents=pp.events; cfg.pushMode=pp.mode; cfg.pushEvery=pp.everyMin;
      const wantPush=E.setPush.checked; if(wantPush&&!cfg.push) enablePush(); else if(!wantPush&&cfg.push) disablePush();
      // Ja inscrito: so atualiza as prefs — re-inscrever trocaria o endpoint a toa.
      else if(wantPush&&cfg.push){ (async()=>{ try{ const reg=await navigator.serviceWorker.getRegistration(); const sub=reg&&await reg.pushManager.getSubscription();
        if(sub) tx({t:'push_prefs', endpoint:sub.endpoint, prefs:pp}); }catch(e){} })(); }
      E.settings.classList.add('hidden'); };
    E.setCancel.onclick=()=>E.settings.classList.add('hidden'); // fecha sem salvar

    // ---------- generic dialog (substitui alert/confirm/prompt nativos) ----------
    let dlgResolve=null;
    function dialog({title,input=false,placeholder='',value='',okText='OK',cancelText='Cancelar',danger=false}){
      return new Promise(res=>{ dlgResolve=res; E.dlgTitle.textContent=title; E.dlgInput.classList.toggle('hidden',!input); E.dlgInput.value=value; E.dlgInput.placeholder=placeholder;
        E.dlgOk.textContent=okText; E.dlgCancel.textContent=cancelText; E.dlgOk.classList.toggle('danger',!!danger); E.dlg.classList.remove('hidden');
        if(input) setTimeout(()=>{E.dlgInput.focus();E.dlgInput.select();},30); }); }
    function dlgClose(val){ E.dlg.classList.add('hidden'); const r=dlgResolve; dlgResolve=null; if(r) r(val); }
    E.dlgOk.onclick=()=>dlgClose(E.dlgInput.classList.contains('hidden')?true:E.dlgInput.value.trim());
    E.dlgCancel.onclick=()=>dlgClose(null);
    E.dlgInput.onkeydown=(e)=>{ if(e.key==='Enter'){e.preventDefault();E.dlgOk.click();} else if(e.key==='Escape'){e.preventDefault();E.dlgCancel.click();} };
    // ---------- info completa da sessão (título do chat) ----------
    // O #title trunca; hover mostra tudo (desktop) e clicar abre a info (funciona no mobile/touch).
    function sessionInfoLines(){ const L=[]; const t=(E.title.textContent||'').trim();
      if(t && t!=='—' && t!=='Jarvis') L.push(['Conversa', t]);
      const mac=machines.find(m=>m.id===currentMachine);
      if(mac && machines.length>1) L.push(['Máquina', mac.label]);
      if(currentAgent) L.push(['Agente', currentAgent]);
      if(curCwd) L.push(['Pasta', curCwd]);
      if(curNative) L.push(['Modo', 'sessão nativa (somente leitura)']);
      return L; }
    function refreshTitleInfo(){ const L=sessionInfoLines(); E.title.title = L.map(([k,v])=>k+': '+v).join('\n'); }
    E.title.onclick=()=>{ const L=sessionInfoLines(); if(!L.length) return;
      dialog({ title: L.map(([k,v])=>k+':\n'+v).join('\n\n'), okText: curCwd?'Copiar pasta':'Fechar', cancelText:'Fechar' })
        .then(r=>{ if(r && curCwd){ try{ navigator.clipboard.writeText(curCwd).then(()=>toast(t('tFolderCopied'))).catch(()=>{}); }catch(e){} } }); };
    // ---------- voice enrollment / speaker list ----------
    function renderSpk(){ if(!E.spkList)return; E.spkList.innerHTML = speakers.length ? 'Vozes cadastradas: ' : 'Nenhuma voz cadastrada ainda.';
      speakers.forEach(n=>{ const c=document.createElement('span'); c.className='chip'; c.textContent='🗣 '+n+' ✕'; c.style.cursor='pointer';
        c.onclick=async()=>{ if(await dialog({title:`Remover a voz "${n}"?`,okText:'Remover',danger:true})) tx({t:'delspk',name:n}); }; E.spkList.appendChild(c); }); }
    function recordClip(ms){ return new Promise((res,rej)=>{ navigator.mediaDevices.getUserMedia({audio:{noiseSuppression:cfg.noise,echoCancellation:true,autoGainControl:true}})
      .then(st=>{ const r=new MediaRecorder(st),ch=[]; r.ondataavailable=e=>ch.push(e.data);
        r.onstop=()=>{ st.getTracks().forEach(t=>t.stop()); const fr=new FileReader(); fr.onload=()=>res(fr.result.split(',')[1]); fr.readAsDataURL(new Blob(ch,{type:'audio/webm'})); };
        r.start(); setTimeout(()=>r.stop(), ms); }).catch(rej); }); }
    async function enrollFlow(){ const name=(await dialog({title:'Seu nome para identificação de voz:',input:true,placeholder:'ex.: Jonathan',okText:'Continuar'})||'').trim(); if(!name)return;
      const N=3, samples=[]; for(let i=0;i<N;i++){ status('listening',`Cadastro ${i+1}/${N}: fale uma frase (3s)…`);
        try{ samples.push(await recordClip(3000)); }catch(e){ addErr('mic erro: '+e.message); status(''); return; }
        status(''); await new Promise(r=>setTimeout(r,500)); }
      note('Enviando cadastro de voz de "'+name+'"…'); tx({t:'enroll',name,samples,ext:'webm'}); }

    // ---------- status indicator ----------
    function status(mode,txt){ E.status.className=mode||''; E.status.innerHTML = mode ? `<span class="pulse"></span>${txt}` : ''; }
    // "parando…" é POR SESSÃO, não global: só aparece na sessão que você parou; troca de sessão
    // reflete o estado da sessão atual. (Não mexe nos status de voz listening/speaking.)
    const stopping={};
    function updateStopStatus(){
      if(currentSession && stopping[sessionStateKey(currentSession,currentSessionRunner)]) status('busy',t('spStopping'));
      else if(currentSession&&busy(currentSession)&&!askActive&&!askingSids.has(askStateKey(currentSession))) status('busy','Jarvis trabalhando...');
      else if(E.status.className==='busy') status('');
    }
    // trava global de operação de voz (resumo/digest): só 1 por vez, independente do chat.
    // libera ao chegar {t:summary}/{t:busy}/{t:error} ou por failsafe de tempo.
    let voiceOp=null,voiceOpSid=null,voiceOpBtn=null,voiceOpHtml='',voiceOpTimer=0;
    function startVoiceOp(kind,btn,label,sid){
      if(voiceOp){ toast('⏳ Já estou gerando um áudio — aguarde terminar.'); return false; }
      voiceOp=kind; voiceOpSid=sid||null; voiceOpBtn=btn||null;
      if(voiceOpBtn){ voiceOpHtml=voiceOpBtn.innerHTML; voiceOpBtn.innerHTML=label||'⏳'; voiceOpBtn.disabled=true; voiceOpBtn.classList.add('busy'); }
      clearTimeout(voiceOpTimer); voiceOpTimer=setTimeout(()=>{ endVoiceOp(); status(''); toast('⚠ Resumo demorou demais — tente de novo.'); },120000);
      return true;
    }
    function endVoiceOp(){
      clearTimeout(voiceOpTimer);
      if(voiceOpBtn&&voiceOpBtn.isConnected){ voiceOpBtn.innerHTML=voiceOpHtml; voiceOpBtn.disabled=false; voiceOpBtn.classList.remove('busy'); }
      voiceOp=null; voiceOpSid=null; voiceOpBtn=null; voiceOpHtml='';
    }
    function setSpeakBtn(){ E.speak.classList.toggle('on',speak); E.speak.textContent=speak?'🔊':'🔇'; }

    // ---------- execution graph: workflows, subagents and background processes ----------
    const workNodes=new Map(), workEvents=new Map(), workTranscriptCursor=new Map(), workCollapsed=new Set(), workConnections=new Map();
    const workTranscriptLoading=new Set();
    let workSelected='', workTab='activity', workFilter='all', workConnected=false, workLoaded=false, workLoadError='', workNextCursor='', workLoadingMore=false, workUnseen=0, workLastFocus=null, workAnnounceT=null;
    const WORK_TERMINAL=new Set(['succeeded','failed','cancelled']);
    const WORK_STATE_LABEL={queued:'Na fila',running:'Em execução',waiting_input:'Precisa de você',succeeded:'Concluído',failed:'Falhou',cancelled:'Cancelado',orphaned:'Órfão',unknown:'Estado desconhecido'};
    const workStateLabel=s=>WORK_STATE_LABEL[s]||'Estado desconhecido';
    const workNodeStatusText=n=>`${n.archivedAt?'Arquivado · ':''}${workStateLabel(n.state)} · ${n.origin==='native'?'nativo':'gerenciado pelo Jarvis'} · ${workDuration(n)}${n.currentStep?' · '+n.currentStep:''}`;
    const workNum=n=>Number.isFinite(Number(n))?Number(n):0;
    function workDuration(n){ const a=workNum(n&&n.startedAt)||workNum(n&&n.queuedAt), b=workNum(n&&n.endedAt)||(Date.now()); if(!a||b<a)return'—'; const s=Math.floor((b-a)/1000); return s<60?s+'s':s<3600?Math.floor(s/60)+'m '+s%60+'s':Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m'; }
    function workTokenText(m){ const n=workNum(m&&m.inputTokens)+workNum(m&&m.outputTokens); return n?kfmt(n):'—'; }
    function workCostText(m){ if(!m||m.costUsd==null||!Number.isFinite(Number(m.costUsd)))return'—'; if(m.costKind==='subscription_included')return'incluído'; const p=m.costKind==='billed'?'$':m.costKind==='estimated_api_equivalent'?'≈$':'Σ$'; return p+Number(m.costUsd).toFixed(4); }
    function workChildren(id){ return [...workNodes.values()].filter(n=>n.parentExecutionId===id); }
    function workDescendants(id){ const out=[], q=workChildren(id); while(q.length){ const n=q.shift(); if(!n||out.some(x=>x.executionId===n.executionId))continue; out.push(n); q.push(...workChildren(n.executionId)); } return out; }
    function workSyncInlineNode(n){ if(!n||!n.executionId)return; document.querySelectorAll(`.subagent[data-execution-id="${CSS.escape(n.executionId)}"]`).forEach(el=>{if(n.title){const title=el.querySelector('.satitle');if(title)title.textContent=n.title;}el.dataset.state=n.state||'unknown';const state=el.querySelector('.sastate');if(state)state.textContent=workStateLabel(n.state).toLowerCase();}); }
    function workMaybeInlineNode(n){ const runner=currentMachine==='all'?routedMachine:currentMachine;if(!strFlow||!n||!n.parentExecutionId||n.sessionId!==currentSession||n.runnerId!==runner)return;const existing=[...document.querySelectorAll('.subagent')].find(el=>el.dataset.executionId===n.executionId),id=existing&&existing.dataset.id||n.providerExecutionId||n.executionId;const rec=ensureSubAgent(id,n.title||n.role||'sub-agente',n.executionId);workSyncInlineNode(n);return rec; }
    function workSort(a,b){ const rank={waiting_input:0,running:1,queued:2,failed:3,orphaned:4,unknown:5,succeeded:6,cancelled:7}; return (rank[a.state]??8)-(rank[b.state]??8) || (workNum(b.endedAt||b.startedAt||b.queuedAt)-workNum(a.endedAt||a.startedAt||a.queuedAt)); }
    function workMatches(n){
      if(E.workMachine.value&&n.runnerId!==E.workMachine.value)return false;
      if(E.workSession.value&&n.sessionId!==E.workSession.value)return false;
      if(E.workAgent.value&&n.agent!==E.workAgent.value)return false;
      if(workFilter==='waiting_input'||workFilter==='running'||workFilter==='queued')return n.state===workFilter&&!n.archivedAt;
      if(workFilter==='completed')return WORK_TERMINAL.has(n.state)&&!n.archivedAt;
      return true;
    }
    function workVisibleSet(){ const yes=new Set(); [...workNodes.values()].forEach(n=>{ if(!workMatches(n))return; let cur=n, guard=0; while(cur&&guard++<50){yes.add(cur.executionId);cur=cur.parentExecutionId&&workNodes.get(cur.parentExecutionId);} }); return yes; }
    function workFillSelect(sel,vals,current,label){ const sorted=[...new Set(vals.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b))); sel.innerHTML=''; const all=document.createElement('option'); all.value=''; all.textContent=label; sel.appendChild(all); sorted.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;o.selected=v===current;sel.appendChild(o);}); }
    function workUpdateScopes(){ const ns=[...workNodes.values()]; workFillSelect(E.workMachine,ns.map(n=>n.runnerId),E.workMachine.value,'Todas'); workFillSelect(E.workSession,ns.map(n=>n.sessionId),E.workSession.value,'Todas'); workFillSelect(E.workAgent,ns.map(n=>n.agent),E.workAgent.value,'Todas'); }
    function workRenderBadge(){ const ns=[...workNodes.values()].filter(n=>!n.archivedAt), need=ns.filter(n=>n.state==='waiting_input').length, active=ns.filter(n=>n.state==='running'||n.state==='queued').length, total=need||active;
      E.workBadge.classList.toggle('hidden',!total); E.workBadge.classList.toggle('need',!!need); E.workBadge.textContent=String(total||'');
      E.workBtn.setAttribute('aria-label',need?`Trabalhos, ${need} precisam de você`:active?`Trabalhos, ${active} ativos`:'Trabalhos'); }
    function workTreeRows(){ const visible=workVisibleSet(), roots=[...workNodes.values()].filter(n=>visible.has(n.executionId)&&(!n.parentExecutionId||!visible.has(n.parentExecutionId))).sort(workSort), out=[];
      const visit=(n,level)=>{ out.push({n,level}); if(!workCollapsed.has(n.executionId)) workChildren(n.executionId).filter(x=>visible.has(x.executionId)).sort(workSort).forEach(x=>visit(x,level+1)); }; roots.forEach(n=>visit(n,1)); return out; }
    function renderWorkTree(preserveFocus){ const active=document.activeElement&&document.activeElement.closest&&document.activeElement.closest('.worknode'), focusId=preserveFocus&&active&&active.dataset.id; E.workTree.innerHTML=''; const rows=workTreeRows();
      if(!rows.length){ const loading=!workLoaded&&!workLoadError, offline=!workConnected&&!workLoaded, icon=loading?'◔':workLoadError?'⚠':offline?'⌁':'🫙', title=loading?'Carregando trabalhos…':workLoadError?'Não foi possível carregar':offline?'Sem conexão com o Hub':'Nenhum trabalho nesta visão', detail=workLoadError|| (offline?'Conecte-se novamente para buscar a primeira visão.':'Os trabalhos aparecem aqui quando uma IA delega ou o Jarvis inicia um processo acompanhável.'); E.workTree.innerHTML=`<div class="workempty"><span class="weicon">${icon}</span><b>${esc(title)}</b><span>${esc(detail)}</span></div>`; return; }
      rows.forEach(({n,level})=>{ const kids=workChildren(n.executionId).length, root=!n.parentExecutionId, b=document.createElement('button'); b.type='button'; b.className='worknode'; b.dataset.id=n.executionId; b.dataset.state=n.state||'unknown'; b.setAttribute('role','treeitem'); b.setAttribute('aria-level',String(level)); b.setAttribute('aria-selected',String(n.executionId===workSelected)); if(kids)b.setAttribute('aria-expanded',String(!workCollapsed.has(n.executionId))); b.style.paddingLeft=(8+(level-1)*15)+'px';
        const role=root&&kids?'orquestrador':n.agent, meta=[role,n.model,n.effort].filter(Boolean).join(' · ')||n.kind||'trabalho', state=(n.archivedAt?'Arquivado · ':'')+workStateLabel(n.state); b.innerHTML=`<span class="wbranch">${kids?(workCollapsed.has(n.executionId)?'▸':'▾'):''}</span><span class="wnmain"><span class="wntitle">${esc(String(n.title||n.summary||n.executionId))}</span><span class="wnmeta">${esc(meta)} · ${workDuration(n)}</span></span><span class="wnstate">${state}</span>`;
        b.onclick=()=>openWorkNode(n.executionId); b.onkeydown=workTreeKeydown; E.workTree.appendChild(b); });
      if(focusId){ const f=E.workTree.querySelector(`.worknode[data-id="${CSS.escape(focusId)}"]`); if(f)f.focus(); }
    }
    function workTreeKeydown(e){ const rows=[...E.workTree.querySelectorAll('.worknode')], i=rows.indexOf(e.currentTarget), id=e.currentTarget.dataset.id, node=workNodes.get(id), kids=workChildren(id).length;
      if(e.key==='ArrowDown'||e.key==='ArrowUp'||e.key==='Home'||e.key==='End'){ e.preventDefault(); const ni=e.key==='Home'?0:e.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,i+(e.key==='ArrowDown'?1:-1))); rows[ni]&&rows[ni].focus(); }
      else if(e.key==='ArrowRight'&&kids){ e.preventDefault(); if(workCollapsed.delete(id))renderWorkTree(true); else {const c=workChildren(id)[0],el=c&&E.workTree.querySelector(`.worknode[data-id="${CSS.escape(c.executionId)}"]`);if(el)el.focus();} }
      else if(e.key==='ArrowLeft'){ e.preventDefault(); if(kids&&!workCollapsed.has(id)){workCollapsed.add(id);renderWorkTree(true);}else if(node&&node.parentExecutionId){const p=E.workTree.querySelector(`.worknode[data-id="${CSS.escape(node.parentExecutionId)}"]`);if(p)p.focus();} }
      else if(e.key==='Enter'||e.key===' '){e.preventDefault();openWorkNode(id);} }
    function workBreadcrumb(n){ const out=[],seen=new Set(); let cur=n; while(cur&&!seen.has(cur.executionId)){seen.add(cur.executionId);out.unshift(cur.title||cur.executionId);cur=cur.parentExecutionId&&workNodes.get(cur.parentExecutionId);} return out.join(' › '); }
    function workEventText(ev){ if(!ev)return''; if(ev.kind==='message'||ev.kind==='summary'||ev.kind==='thinking'||ev.kind==='diagnostic')return ev.text||ev.message||''; if(ev.kind==='state_changed')return `${workStateLabel(ev.from)} → ${workStateLabel(ev.to)}${ev.reason?' · '+ev.reason:''}`; if(ev.kind==='input_requested')return ev.summary||'Aguardando sua resposta'; if(ev.kind==='input_resolved')return `Intervenção ${ev.state||'resolvida'}`; if(ev.kind==='artifact')return (ev.artifact&&ev.artifact.name)||'Arquivo publicado'; if(ev.kind==='tool'){const x=ev.tool||{};return x.summary||x.name||'Ferramenta';} if(ev.kind==='truncated')return `${ev.dropped||0} eventos omitidos · ${ev.reason||'limite de retenção'}`; if(ev.kind==='agent_event'){ const a=ev.event||{}; return a.text||(a.tool&&(a.tool.summary||a.tool.name))||a.kind||'Atividade do agente'; } if(ev.kind==='usage')return 'Métricas atualizadas'; return ev.kind||'Evento'; }
    function workEventIcon(ev){ return ({message:'💬',summary:'📝',thinking:'◔',state_changed:'●',input_requested:'⚠',input_resolved:'✓',artifact:'📄',usage:'◔',truncated:'⚠',diagnostic:'⚠',agent_event:'🔧',tool:'🔧'})[ev&&ev.kind]||'·'; }
    function workEventHtml(ev){ const text=workEventText(ev), when=ev&&ev.at?new Date(ev.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}):''; if(ev&&(ev.kind==='message'||ev.kind==='summary'))return `<div class="msg bot">${md(String(text||''))}</div>`; return `<div class="workevent"><div class="wetop"><span>${workEventIcon(ev)}</span><b>${esc(String(ev.kind||'evento'))}</b><span>${esc(when)}</span></div>${text?`<div class="wetext">${esc(String(text))}</div>`:''}</div>`; }
    function workActivityFromEvent(ev){
      if(!ev)return null;
      if(ev.kind==='message'||ev.kind==='summary')return {schemaVersion:1,kind:'text_block',text:ev.text||'',executionId:ev.executionId};
      if(ev.kind==='thinking')return {schemaVersion:1,kind:'thinking',text:ev.text||'Pensando...',executionId:ev.executionId};
      if(ev.kind==='tool'&&ev.tool){ const st=ev.tool.status==='failed'?'tool_failed':ev.tool.status==='completed'?'tool_completed':'tool_started'; return {schemaVersion:1,kind:st,tool:ev.tool,executionId:ev.executionId}; }
      if(ev.kind==='agent_event'&&ev.event){ const a=Object.assign({schemaVersion:1},ev.event); if(!a.executionId)a.executionId=ev.executionId; return a; }
      if(ev.kind==='diagnostic')return {schemaVersion:1,kind:'thinking',text:ev.message||ev.code||'Diagnóstico',executionId:ev.executionId};
      return null;
    }
    function renderWorkConversation(events){
      const activity=events.map(workActivityFromEvent).filter(Boolean);
      return activity.length?renderActivityBlock(activity,{keepWork:true}):null;
    }
    function workLatestInput(events){ const resolved=new Set(events.filter(e=>e.kind==='input_resolved').map(e=>e.inputId)); return [...events].reverse().find(e=>e.kind==='input_requested'&&!resolved.has(e.inputId)); }
    function workInputHtml(ev){ if(!ev)return''; const choices=Array.isArray(ev.choices)?ev.choices:[]; return `<div class="worknotice"><b>Precisa de você</b><div>${esc(String(ev.summary||'Esta execução aguarda uma decisão.'))}</div><div class="workcontrols" style="margin-top:8px">${ev.inputKind==='approval'?'<button type="button" data-input="approve">Aprovar</button><button type="button" class="danger" data-input="reject">Rejeitar</button>':choices.map((c,i)=>`<button type="button" class="ghost" data-input="answer" data-answer="${esc(String(c))}">${esc(String(c))}</button>`).join('')+'<button type="button" class="ghost" data-input="answer">Responder…</button>'}</div></div>`; }
    function workMetricsHtml(n){ const own=(n.metrics&&n.metrics.self)||{}, sub=(n.metrics&&n.metrics.subtree)||null, block=(title,m)=>`<div class="worksection">${title}</div><div class="workmetrics"><div class="workmetric"><span>Tokens</span><b>${workTokenText(m)}</b></div><div class="workmetric"><span>Ferramentas</span><b>${workNum(m.toolCalls)||'—'}</b></div><div class="workmetric"><span>Custo</span><b>${workCostText(m)}</b></div><div class="workmetric"><span>Duração</span><b>${workDuration(n)}</b></div></div>`; return block('Este trabalho',own)+(sub?block('Incluindo descendentes',sub):''); }
    function workCapabilitiesHtml(n){ const c=n.capabilities||{}, online=workConnected&&(!workConnections.has(n.runnerId)||workConnections.get(n.runnerId)==='online'), reason=!online?'A máquina dona está offline ou reconciliando.':c.reason||'Este controle não é suportado pelo adapter ou pelo estado atual.', liveState=online&&(n.state==='running'||n.state==='waiting_input'), terminal=WORK_TERMINAL.has(n.state), root=!n.parentExecutionId, cancelOk=liveState&&(c.cancel==='node'||c.cancel==='subtree'||(c.cancel==='root'&&root)), subtreeOk=liveState&&(c.cancel==='subtree'||(c.cancel==='root'&&root)), steerOk=online&&((c.steer==='running'&&liveState)||(c.steer==='queued'&&n.state==='queued')), retryOk=online&&terminal&&!!c.retry;
      const b=(label,act,ok,cls='ghost')=>`<button type="button" class="${cls}" data-control="${act}" ${ok?'':`disabled title="${esc(reason)}"`}>${label}</button>`;
      const unavailable=[!cancelOk&&'cancelar nó',!subtreeOk&&'cancelar árvore',!steerOk&&'orientar',!retryOk&&'tentar novamente',!terminal&&(n.archivedAt?'desarquivar':'arquivar')].filter(Boolean);
      return `<div class="worksection">Controles</div><div class="workcontrols">${b('Cancelar','cancel',cancelOk,'danger')}${b('Cancelar árvore','cancel_subtree',subtreeOk,'danger')}${b('Orientar','steer',steerOk)}${b('Tentar novamente','retry',retryOk)}${b(n.archivedAt?'Desarquivar':'Arquivar','archive',workConnected&&terminal)}</div>${unavailable.length?`<div class="workcapwhy">Indisponíveis: ${esc(unavailable.join(', '))}. ${esc(reason)}</div>`:''}`; }
    function workArtifactPath(n,a){ const p=String(a.relativePath||''); if(!p)return''; if(/^(?:[A-Za-z]:[\\/]|\/)/.test(p))return p; const base=String(n.worktree||n.cwd||'').replace(/[\\/]$/,''); if(!base)return p; return base+(base.includes('\\')?'\\':'/')+p; }
    function workArtifactConflicts(n){ const owners=new Map(), ids=new Set([n.executionId,...workDescendants(n.executionId).map(x=>x.executionId)]); ids.forEach(id=>(workEvents.get(id)||[]).forEach(ev=>{const a=ev.artifact;if(ev.kind!=='artifact'||!a||!a.relativePath)return;const key=String(a.relativePath).replace(/\\/g,'/').toLowerCase(),set=owners.get(key)||new Set();set.add(id);owners.set(key,set);}));return new Set([...owners].filter(([,set])=>set.size>1).map(([path])=>path)); }
    function loadMoreWorkTranscript(id){ const cursor=workTranscriptCursor.get(id); if(!id||!cursor||workTranscriptLoading.has(id))return false; workTranscriptLoading.add(id); tx({t:'execution_open',executionId:id,cursor,limit:500}); return true; }
    function maybeAutoMoreWorkDetail(){ const id=workSelected; if(!id||E.workPanel.classList.contains('hidden')||!workTranscriptCursor.get(id))return; if(nearPaneBottom(E.workDetailBody,220)||E.workDetailBody.scrollHeight<=E.workDetailBody.clientHeight+70)loadMoreWorkTranscript(id); }
    function renderWorkDetail(){ const n=workNodes.get(workSelected); if(!n){ E.workCrumb.textContent='';E.workNodeTitle.textContent='Selecione um trabalho';E.workNodeState.textContent='';E.workDetailBody.innerHTML='<div class="workempty"><span class="weicon">🧩</span><span>Selecione um trabalho para acompanhar.</span></div>';return; }
      const events=workEvents.get(n.executionId)||[], cap=n.capabilities||{}; E.workCrumb.textContent=workBreadcrumb(n); E.workNodeTitle.textContent=n.title||n.executionId; E.workNodeState.textContent=workNodeStatusText(n);
      E.workPanel.querySelectorAll('.worktabs [data-tab]').forEach(b=>{const on=b.dataset.tab===workTab;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;});
      let h='', conn=workConnections.get(n.runnerId); if(conn&&conn!=='online')h+=`<div class="worknotice"><b>Máquina ${esc(conn)}.</b> Esta é a última visão persistida; os controles podem ficar indisponíveis até a reconciliação.</div>`; if(n.state==='orphaned')h+='<div class="worknotice err"><b>Conexão perdida.</b> O estado final ainda não foi observado; o Jarvis tentará reconciliar sem marcar cancelamento por inferência.</div>'; if(n.state==='unknown')h+='<div class="worknotice">Estado parcial: o provider ainda não publicou lifecycle suficiente.</div>'; if(n.truncated)h+='<div class="worknotice">Histórico do trabalho truncado. O que aparece abaixo é apenas a parte preservada.</div>'; if(n.summary)h+=`<div class="worknotice" style="border-color:var(--line);background:#ffffff07;color:var(--text)">${esc(String(n.summary))}</div>`;
      const pending=workLatestInput(events); if(pending)h+=workInputHtml(pending);
      if(workTab==='transcript')workTab='activity';
      if(workTab==='activity'){ h+=workMetricsHtml(n); E.workDetailBody.innerHTML=h; const visible=events.filter(e=>!['node_created','artifact','usage'].includes(e.kind)); const conv=renderWorkConversation(visible);
        if(conv)E.workDetailBody.appendChild(conv); else E.workDetailBody.insertAdjacentHTML('beforeend','<div class="workempty"><span class="weicon">◔</span><span>Aguardando atividade publicável.</span></div>');
        if(workTranscriptCursor.get(n.executionId))E.workDetailBody.insertAdjacentHTML('beforeend','<button type="button" class="ghost" data-transcript-more style="width:100%;margin-top:8px">Carregar mais</button>');
        bindWorkDetail(n,events); scheduleAutoPager(maybeAutoMoreWorkDetail); return; }
      else if(workTab==='transcript'){ const level=cap.transcript||'none'; h+=`<div class="worknotice">Mensagens publicadas pelo adapter: <b>${esc(level)}</b>. O painel nunca apresenta raciocínio privado.</div>`; if(n.prompt)h+=`<div class="worksection">Instrução delegada</div><div class="workevent"><div class="wetext">${esc(String(n.prompt))}</div></div>`; const transcript=events.filter(e=>e.kind==='message'||e.kind==='summary'||(e.kind==='thinking'&&e.published)); h+=transcript.length?transcript.map(workEventHtml).join(''):`<div class="workempty"><span class="weicon">💬</span><span>${level==='none'?'Este adapter não fornece mensagens publicáveis.':'Nenhuma mensagem publicada ainda.'}</span></div>`; if(workTranscriptCursor.get(n.executionId))h+='<button type="button" class="ghost" data-transcript-more style="width:100%;margin-top:8px">Carregar mais mensagens</button>'; }
      else if(workTab==='files'){ const arts=events.filter(e=>e.kind==='artifact'&&e.artifact).map(e=>e.artifact), conflicts=workArtifactConflicts(n); if(conflicts.size)h+=`<div class="worknotice"><b>Possível conflito:</b> ${conflicts.size} arquivo${conflicts.size===1?' aparece':'s aparecem'} em mais de um descendente. Confira os worktrees antes de integrar.</div>`; h+=arts.length?arts.map(a=>{const path=workArtifactPath(n,a),disabled=!path||a.redacted,key=String(a.relativePath||'').replace(/\\/g,'/').toLowerCase(),conflict=conflicts.has(key),counts=(a.adds||a.dels)?`<span class="fadd">+${workNum(a.adds)}</span><span class="fdel">-${workNum(a.dels)}</span>`:'';return `<button type="button" class="workfile" data-artifact="${esc(String(a.artifactId||''))}" ${disabled?`disabled title="${a.redacted?'Conteúdo redigido pelo provider':'O provider publicou somente metadados'}"`:''}><span>${a.kind==='diff'?'±':'📄'}</span><span class="wfname">${esc(String(a.name||a.relativePath||'arquivo'))}</span>${counts}<span class="wfmeta">${conflict?'⚠ conflito · ':''}${a.redacted?'redigido':a.size?kfmt(a.size):a.kind||''}</span></button>`;}).join(''):`<div class="workempty"><span class="weicon">📄</span><span>${cap.files==='none'?'Este adapter não publica arquivos.':'Nenhum arquivo atribuído a este trabalho.'}</span></div>`; }
      else { const row=(k,v)=>v!=null&&v!==''?`<div class="workevent"><div class="wetop"><b>${k}</b></div><div class="wetext">${esc(String(v))}</div></div>`:''; h+=workMetricsHtml(n)+row('IA',n.agent)+row('Modelo',n.model)+row('Esforço',n.effort)+row('Máquina',n.runnerId)+row('Sessão',n.sessionId)+row('Origem',n.origin)+row('Certificação',n.certification)+row('Aquisição',n.acquisitionSurface)+row('Dependências',(n.dependsOn||[]).join(', '))+row('Workspace isolado',cap.isolatedWorkspace)+row('Pasta',n.worktree||n.cwd)+workCapabilitiesHtml(n); }
      E.workDetailBody.innerHTML=h; bindWorkDetail(n,events); scheduleAutoPager(maybeAutoMoreWorkDetail); }
    function bindWorkDetail(n,events){ E.workDetailBody.querySelectorAll('[data-control]').forEach(b=>b.onclick=()=>workControl(n,b.dataset.control)); E.workDetailBody.querySelectorAll('[data-input]').forEach(b=>b.onclick=()=>workAnswer(n,workLatestInput(events),b.dataset.input,b.dataset.answer)); E.workDetailBody.querySelectorAll('[data-artifact]').forEach(b=>b.onclick=()=>{const ev=events.find(e=>e.kind==='artifact'&&e.artifact&&e.artifact.artifactId===b.dataset.artifact),p=ev&&workArtifactPath(n,ev.artifact);if(!p)return;if(n.runnerId&&n.runnerId!==routedMachine){routedMachine=n.runnerId;tx({t:'runner',runnerId:n.runnerId});}openFile(p,ev.artifact.kind==='diff'?'edit':'read',{keepWork:true});}); const more=E.workDetailBody.querySelector('[data-transcript-more]');if(more)more.onclick=()=>{more.disabled=true;more.textContent='Carregando…';loadMoreWorkTranscript(n.executionId);}; }
    async function workControl(n,action){ if(action==='archive'){ tx({t:'execution_archive',requestId:uid(),executionId:n.executionId,archived:!n.archivedAt});return; } let message; if(action==='steer'){message=await dialog({title:'Orientação para este trabalho',input:true,placeholder:'O que ele deve ajustar?',okText:'Enviar'});if(!message)return;} if(action==='cancel'||action==='cancel_subtree'){const count=action==='cancel_subtree'?1+workDescendants(n.executionId).length:1;if(!await dialog({title:`Cancelar ${count} trabalho${count===1?'':'s'}?\nO progresso já publicado será preservado.`,okText:'Cancelar trabalho',danger:true}))return;} tx({t:'execution_control',requestId:uid(),executionId:n.executionId,action,message}); }
    async function workAnswer(n,ev,decision,preset){ if(!ev)return; let answer=preset||''; if(decision==='answer'&&!answer){answer=await dialog({title:ev.summary||'Responder ao trabalho',input:true,placeholder:'Sua resposta',okText:'Responder'});if(!answer)return;} tx({t:'execution_input',requestId:uid(),executionId:n.executionId,inputId:ev.inputId,decision,answer:answer||undefined}); }
    function workSetHash(push=true){ const p=new URLSearchParams(); if(currentSession){p.set('session',currentSession);p.set('runner',currentSessionRunner);} if(workSelected)p.set('work',workSelected); const h=p.toString(),url=h?'#'+h:location.pathname+location.search;if(location.hash===(h?'#'+h:''))return;(push?history.pushState:history.replaceState).call(history,null,'',url); }
    function openWorkNode(id,{fromHash=false}={}){ const n=workNodes.get(id); workSelected=id; workUnseen=0; E.workNew.classList.add('hidden'); E.workPanel.classList.add('show-detail'); renderWorkTree(); renderWorkDetail(); tx({t:'execution_open',executionId:id,limit:500}); if(!fromHash)workSetHash(); }
    function openWorkPanel({fromHash=false}={}){ workLastFocus=document.activeElement; closeFilePanel();E.workPanel.classList.remove('hidden');E.workPanel.setAttribute('aria-hidden','false');closeSide();workConnected=!!(ws&&ws.readyState===1);renderWorkConnection();workUpdateScopes();renderWorkTree();renderWorkDetail();tx({t:'executions_list',scope:'all',limit:500});if(!fromHash&&workSelected)workSetHash();setTimeout(()=>{const f=E.workPanel.querySelector('.worknode[aria-selected="true"]')||E.workClose;f&&f.focus();},20); }
    function closeWorkPanel(clearHash=true){ E.workPanel.classList.add('hidden');E.workPanel.classList.remove('show-detail','max');E.workPanel.setAttribute('aria-hidden','true');E.workMax.textContent='⛶';if(clearHash){workSelected='';workSetHash(true);}if(workLastFocus&&workLastFocus.isConnected)workLastFocus.focus(); }
    function renderWorkConnection(){ const bad=[...workConnections.values()].filter(x=>x!=='online').length; E.workLive.textContent=!workConnected?'offline · última visão':bad?`parcial · ${bad} máquina${bad===1?'':'s'}`:'ao vivo';E.workLive.classList.toggle('offline',!workConnected||!!bad); }
    function workAnnounce(text){ clearTimeout(workAnnounceT); workAnnounceT=setTimeout(()=>{E.workAnnounce.textContent=text;},400); }
    function workApplyEvent(ev){ if(!ev||!ev.executionId)return; let n=workNodes.get(ev.executionId); if(ev.kind==='node_created'&&ev.node){n=ev.node;workNodes.set(n.executionId,n);workMaybeInlineNode(n);}else if(n&&ev.kind==='state_changed'){n=Object.assign({},n,{state:ev.to,summary:ev.reason||n.summary,startedAt:ev.to==='running'&&!n.startedAt?(ev.at||Date.now()):n.startedAt,endedAt:WORK_TERMINAL.has(ev.to)?(ev.at||Date.now()):n.endedAt});workNodes.set(n.executionId,n);}else if(n&&ev.kind==='archived'){n=Object.assign({},n,{archivedAt:ev.archived?(ev.at||Date.now()):undefined});workNodes.set(n.executionId,n);}else if(n&&ev.kind==='usage'&&ev.usage){const scope=ev.scope==='subtree'?'subtree':'self',metrics=Object.assign({},n.metrics||{}),old=Object.assign({},metrics[scope]||{}),next=Object.assign({},old),replace=ev.measure==='cumulative';['inputTokens','cachedInputTokens','outputTokens','costUsd'].forEach(k=>{if(ev.usage[k]!=null)next[k]=replace?workNum(ev.usage[k]):workNum(old[k])+workNum(ev.usage[k]);});if(ev.usage.costKind)next.costKind=ev.usage.costKind;metrics[scope]=next;workNodes.set(n.executionId,Object.assign({},n,{metrics}));}else if(n&&(ev.kind==='tool'||ev.kind==='agent_event')){const a=ev.kind==='agent_event'&&ev.event,usage=a&&a.kind==='usage'&&a.usage,tool=ev.kind==='tool'?ev.tool:a&&a.tool,isStart=tool&&tool.status==='started',metrics=Object.assign({},n.metrics||{}),scope=a&&a.usageScope==='subtree'?'subtree':'self',own=Object.assign({},metrics[scope]||{});if(usage){['inputTokens','cachedInputTokens','outputTokens','costUsd'].forEach(k=>{if(usage[k]!=null)own[k]=workNum(own[k])+workNum(usage[k]);});if(usage.costKind)own.costKind=usage.costKind;}if(isStart)own.toolCalls=workNum(own.toolCalls)+1;if(usage||isStart){metrics[scope]=own;workNodes.set(n.executionId,Object.assign({},n,{metrics}));}}
      if(n)workSyncInlineNode(n);
      if(ev.kind!=='node_created'){const list=workEvents.get(ev.executionId)||[];if(!ev.eventId||!list.some(x=>x.eventId===ev.eventId)){list.push(ev);if(list.length>5000)list.splice(0,list.length-5000);workEvents.set(ev.executionId,list);}}
      workRenderBadge(); workUpdateScopes(); renderWorkTree(true); if(workSelected===ev.executionId&&!E.workPanel.classList.contains('hidden')){const atEnd=E.workDetailBody.scrollHeight-E.workDetailBody.scrollTop-E.workDetailBody.clientHeight<45;if(atEnd){renderWorkDetail();E.workDetailBody.scrollTop=E.workDetailBody.scrollHeight;}else{workUnseen++;E.workNew.textContent=workUnseen+' novo'+(workUnseen===1?' evento':'s eventos');E.workNew.classList.remove('hidden');}} if(ev.kind==='input_requested')workAnnounce('Um trabalho precisa de você.'); }
    function workApplySnapshot(m){ workLoaded=true;workLoadError='';if(m.scope==='all'&&!workLoadingMore)workNodes.clear();workLoadingMore=false;workNextCursor=m.nextCursor||'';E.workMore.classList.toggle('hidden',!workNextCursor);E.workMore.disabled=false;E.workMore.textContent='Mostrar mais';(Array.isArray(m.nodes)?m.nodes:[]).forEach(n=>{if(n&&n.executionId){workNodes.set(n.executionId,n);workSyncInlineNode(n);}});workRenderBadge();workUpdateScopes();renderWorkTree();scheduleAutoPager(maybeAutoMoreWork);const wanted=hashWork();if(wanted&&workNodes.has(wanted)&&workSelected!==wanted){if(E.workPanel.classList.contains('hidden'))openWorkPanel({fromHash:true});openWorkNode(wanted,{fromHash:true});}else if(workSelected&&!workNodes.has(workSelected)){workSelected='';renderWorkDetail();} }
    E.workBtn.onclick=()=>openWorkPanel(); E.workClose.onclick=()=>closeWorkPanel(); E.workBack.onclick=()=>{const prior=workSelected;workSelected='';E.workPanel.classList.remove('show-detail');renderWorkTree();renderWorkDetail();workSetHash(true);const n=prior&&E.workTree.querySelector(`.worknode[data-id="${CSS.escape(prior)}"]`);n&&n.focus();};
    E.workMax.onclick=()=>{const max=E.workPanel.classList.toggle('max');E.workMax.textContent=max?'🗗':'⛶';E.workMax.title=max?'Restaurar':'Maximizar';};
    E.workPanel.querySelectorAll('.workfilters [data-filter]').forEach(b=>b.onclick=()=>{workFilter=b.dataset.filter;E.workPanel.querySelectorAll('.workfilters [data-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderWorkTree();});
    [E.workMachine,E.workSession,E.workAgent].forEach(s=>s.onchange=()=>renderWorkTree());
    E.workPanel.querySelectorAll('.worktabs [data-tab]').forEach(b=>{b.onclick=()=>{workTab=b.dataset.tab;renderWorkDetail();};b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...E.workPanel.querySelectorAll('.worktabs [data-tab]')],i=tabs.indexOf(b),next=e.key==='Home'?tabs[0]:e.key==='End'?tabs[tabs.length-1]:tabs[(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];next.click();next.focus();};});
    function workTreeScroller(){ return E.workTree&&E.workTree.closest('.worktreewrap'); }
    function loadMoreWork(){ if(!workNextCursor||workLoadingMore)return;workLoadingMore=true;E.workMore.disabled=true;E.workMore.textContent='Carregando…';tx({t:'executions_list',scope:'all',cursor:workNextCursor,limit:500}); }
    function maybeAutoMoreWork(){ const el=workTreeScroller(); if(!el||E.workPanel.classList.contains('hidden')||!workNextCursor||workLoadingMore)return; if(nearPaneBottom(el,220)||el.scrollHeight<=el.clientHeight+70)loadMoreWork(); }
    E.workMore.onclick=loadMoreWork;
    { const el=workTreeScroller(); if(el)el.addEventListener('scroll',maybeAutoMoreWork); }
    E.workDetailBody.addEventListener('scroll',maybeAutoMoreWorkDetail);
    E.workNew.onclick=()=>{workUnseen=0;E.workNew.classList.add('hidden');renderWorkDetail();E.workDetailBody.scrollTop=E.workDetailBody.scrollHeight;};
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!E.workPanel.classList.contains('hidden')){e.stopPropagation();closeWorkPanel();}});
    setInterval(()=>{if(!E.workPanel.classList.contains('hidden')&&[...workNodes.values()].some(n=>n.state==='running')){renderWorkTree(true);const n=workNodes.get(workSelected);if(n)E.workNodeState.textContent=workNodeStatusText(n);}},5000);

    // ---------- ws ----------
    function tx(o){ if(ws&&ws.readyState===1) ws.send(JSON.stringify(o)); }
    function frameRunner(m){ return (m&&m.runnerId)||selectedRunner(); }
    function currentFrame(m,sid){ return (sid||(m&&m.sessionId))===currentSession&&frameRunner(m)===currentSessionRunner; }
    // deep-link: preserves both the conversation and the selected work. Old #<sessionId> links stay valid.
    function hashParams(){ const raw=location.hash.slice(1); if(!raw)return new URLSearchParams(); if(!raw.includes('=')&&!raw.includes('&')){const p=new URLSearchParams();p.set('session',decodeURIComponent(raw));return p;}return new URLSearchParams(raw); }
    function setHash(id){ const p=new URLSearchParams(); if(id){p.set('session',id);p.set('runner',currentSessionRunner);} if(workSelected&&!E.workPanel.classList.contains('hidden'))p.set('work',workSelected); const h=p.toString(); if(h){if(location.hash!=='#'+h)history.replaceState(null,'','#'+h);}else if(location.hash)history.replaceState(null,'',location.pathname+location.search); }
    const hashSession = () => hashParams().get('session')||'';
    const hashRunner = () => hashParams().get('runner')||'';
    const hashWork = () => hashParams().get('work')||'';
    function applyDeepLink(){ const h=hashSession(),r=hashRunner()||selectedRunner(),w=hashWork(); if(h&&(h!==currentSession||r!==currentSessionRunner)&&(isNative(h)||sessions.some(s=>s.id===h&&(!hashRunner()||(s.runnerId||selectedRunner())===r))))openSession(h,r);if(w){if(E.workPanel.classList.contains('hidden'))openWorkPanel({fromHash:true});if(workNodes.has(w)&&workSelected!==w)openWorkNode(w,{fromHash:true});}else if(!E.workPanel.classList.contains('hidden'))closeWorkPanel(false); }
    addEventListener('hashchange',applyDeepLink);addEventListener('popstate',applyDeepLink);
    let reconnectT=null;
    function scheduleReconnect(){ if(reconnectT)return; reconnectT=setTimeout(()=>{ reconnectT=null; connect(); },1200); }
    // ---------- auth gate (device pairing + optional 2nd factor; see auth.ts) ----------
    let authToken=localStorage.getItem('jarvis_token')||'', authUser=null, authed=false, enteredConn=false, gateEl=null, gateClaimed=false;
    let gateMode='pair', authPass=localStorage.getItem('jarvis_pass')||''; // pass kept only if user opted to remember
    function deviceLabelGuess(){ const u=navigator.userAgent; if(/android/i.test(u))return'Android'; if(/iphone|ipad|ipod/i.test(u))return'iPhone'; if(/mac/i.test(u))return'Mac'; if(/windows/i.test(u))return'Windows'; if(/linux/i.test(u))return'Linux'; return'Dispositivo'; }
    function buildGate(){ const g=document.createElement('div'); g.id='gate';
      g.innerHTML='<div class="gatebox"><div class="gatelogo">🧠 Jarvis</div><div id="gateTitle"></div><input id="gateCode" autocomplete="off" autocapitalize="off" spellcheck="false"><input id="gateLabel" placeholder="Nome deste dispositivo"><button id="gateGo"></button><div id="gateErr" class="gateerr"></div><div id="gateHint" class="gatehint"></div></div>';
      document.body.appendChild(g); g.querySelector('#gateLabel').value=deviceLabelGuess();
      g.querySelector('#gateGo').onclick=submitGate; g.querySelector('#gateCode').addEventListener('keydown',e=>{ if(e.key==='Enter')submitGate(); }); return g; }
    function showGate(claimed){ authed=false; gateMode='pair'; gateClaimed=!!claimed; if(!gateEl)gateEl=buildGate(); gateEl.style.display='flex';
      gateEl.querySelector('#gateTitle').textContent=claimed?'Entre com um código de convite':'Primeiro acesso — torne-se o dono desta instância';
      const c=gateEl.querySelector('#gateCode'); c.type='text'; c.placeholder=claimed?'Código do convite':'Código de claim (do servidor)';
      gateEl.querySelector('#gateLabel').style.display='';
      gateEl.querySelector('#gateGo').textContent=claimed?'Entrar':'Reivindicar';
      gateEl.querySelector('#gateHint').textContent=claimed?'Peça um convite ao dono do Jarvis.':'O código apareceu no log do servidor e em ~/.jarvis/claim-code.txt';
      const hv=(location.hash||'').match(/invite=([^&]+)/); if(claimed&&hv&&!c.value)c.value=decodeURIComponent(hv[1]);
      gateEl.querySelector('#gateErr').textContent='';
      try{ if(document.activeElement!==c)c.focus(); }catch(e){} }
    function showVerify(err){ authed=false; gateMode='verify'; if(!gateEl)gateEl=buildGate(); gateEl.style.display='flex';
      gateEl.querySelector('#gateTitle').textContent='Senha do dono (2º fator)';
      const c=gateEl.querySelector('#gateCode'); c.type='password'; c.placeholder='Senha'; c.value='';
      gateEl.querySelector('#gateLabel').style.display='none';
      gateEl.querySelector('#gateGo').textContent='Entrar';
      gateEl.querySelector('#gateHint').textContent='Este Jarvis exige a senha do dono além do dispositivo.';
      gateEl.querySelector('#gateErr').textContent=err||'';
      try{ c.focus(); }catch(e){} }
    function hideGate(){ if(gateEl)gateEl.style.display='none'; }
    function gateError(t){ if(gateEl)gateEl.querySelector('#gateErr').textContent=t||''; }
    function submitGate(){ if(!gateEl)return; const val=gateEl.querySelector('#gateCode').value.trim();
      if(gateMode==='verify'){ if(!val){ gateError('Informe a senha.'); return; } authPass=val; gateError(''); tx({t:'verify',pass:val}); return; }
      const label=gateEl.querySelector('#gateLabel').value.trim()||deviceLabelGuess();
      if(!val){ gateError('Informe o código.'); return; } gateError(''); tx({ t: gateClaimed?'redeem':'claim', code:val, label }); }
    function postAuth(){ tx({t:'wake',enabled:cfg.wake}); tx({t:'executions_list',scope:'all',limit:500}); if(authUser&&authUser.role==='owner')tx({t:'adaptive_approvals'}); if(currentMachine!=='local'){ restoringMachine=true; } else if(currentSession) openSession(currentSession,currentSessionRunner); if(cfg.push) enablePush(); requestCommands(); if(hashWork())openWorkPanel({fromHash:true}); }
    function enter(){ if(enteredConn)return; enteredConn=true; authed=true; hideGate(); if((location.hash||'').indexOf('invite=')>=0){ try{ history.replaceState(null,'','/'); }catch(e){} } postAuth(); if(window.__jarvisNative){ if(window.__jarvisNative.reregister&&cfg.push) window.__jarvisNative.reregister(); if(window.__jarvisNative.wakeStart&&cfg.wake) window.__jarvisNative.wakeStart(); } }

    function connect(){ ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host);
      ws.onopen=()=>{ E.dot.classList.add('on'); workConnected=true; renderWorkConnection(); enteredConn=false; if(authToken) tx({t:'auth',token:authToken}); else tx({t:'authinfo'}); }; // autentica antes de tudo
      ws.onclose=()=>{ E.dot.classList.remove('on'); workConnected=false; renderWorkConnection(); scheduleReconnect(); };
      ws.onmessage=(e)=>{ const m=JSON.parse(e.data);
        // Auto-recarregar quando a UI muda no servidor: guarda a 1ª versão recebida (a do HTML que
        // esta pagina carregou); se depois chegar outra, o arquivo mudou -> esta pagina esta velha.
        // Espera o turno atual terminar pra nao recarregar no meio de uma resposta.
        if(m.t==='version'){ if(m.contractVersion!==1){ addErr(`Cliente incompatível com o contrato de eventos ${m.contractVersion}; recarregue a página.`); E.sendBtn.disabled=true; return; } if(myVer==null){ myVer=m.v; } else if(m.v!==myVer){ needReload=true; maybeReload(); } return; }
        if(m.t==='authinfo'){ showGate(m.claimed); }
        else if(m.t==='authed'){ if(m.token){ authToken=m.token; localStorage.setItem('jarvis_token',authToken); } authUser=m.user||authUser; updateOwnerUI(); enter(); }
        else if(m.t==='need_pass'){ if(m.error){ authPass=''; localStorage.removeItem('jarvis_pass'); showVerify(m.error); } else if(authPass){ tx({t:'verify',pass:authPass}); } else { showVerify(''); } }
        else if(m.t==='sec_state'){ renderSec(m); }
        else if(m.t==='sec_invite_created'){ showInvite(m.code); }
        else if(m.t==='runner_token'){ showRunnerCmd(m.token,m.label); }
        else if(m.t==='pass_set'){ toast(m.enabled?'🔒 Senha do dono definida.':'Senha do dono removida.'); }
        else if(m.t==='summary_cfg'){ if(m.cfg) sumCfg=m.cfg; if(!E.settings.classList.contains('hidden')) fillSumSelects(); }
        else if(m.t==='adaptive_policy'){ renderAdaptivePolicy(m); }
        else if(m.t==='adaptive_approvals'){ renderAdaptiveApprovals(m.approvals||[]); }
        else if(m.t==='execution_cfg'){ const c=m.cfg||{}; E.setExecEnabled.checked=c.enabled!==false; E.setExecRetention.value=c.retentionDays||30; E.setExecMaxEvents.value=c.maxEvents||5000; E.setExecConcurrency.value=c.maxConcurrency||6; E.setExecDepth.value=c.maxDepth||3; E.setExecDefaultWrite.checked=!!c.defaultWrite; E.setExecWorktree.value=c.worktreeRoot||'';
          E.execCfgNote.textContent=m.saved?(m.restartRequired?'✓ Política salva. Reinicie o Hub para aplicar: '+(m.restartFields||[]).join(', ')+'.':'✓ Política salva e aplicada para novas delegações.'):'Ativação, retenção, limite do diário e raiz de worktrees exigem reinício; concorrência, profundidade e escrita padrão valem para novas delegações.'; }
        else if(m.t==='voice_cfg'){ renderVoiceCfg(m.cfg||{}); }
        else if(m.t==='routines'){ routineTimezone=m.timezone||routineTimezone; renderRoutines(m.routines||[]); validateRoutineCron(); }
        else if(m.t==='fleet'){ renderFleet(m); }
        else if(m.t==='executions_snapshot'){ workApplySnapshot(m); }
        else if(m.t==='execution_delta'){ workApplyEvent(m.event); }
        else if(m.t==='execution_transcript'){
          if(m.node&&m.node.executionId)workNodes.set(m.node.executionId,m.node);
          workTranscriptLoading.delete(m.executionId);
          const old=workEvents.get(m.executionId)||[], wasEmpty=!old.length, wasAtEnd=nearPaneBottom(E.workDetailBody,90), merged=[], seen=new Set();
          [...old,...(Array.isArray(m.events)?m.events:[])].forEach(ev=>{const key=ev&&ev.eventId;if(key&&seen.has(key))return;if(key)seen.add(key);merged.push(ev);}); merged.sort((a,b)=>(workNum(a&&a.seq)-workNum(b&&b.seq))||(workNum(a&&a.at)-workNum(b&&b.at)));
          workEvents.set(m.executionId,merged.slice(-5000)); workTranscriptCursor.set(m.executionId,m.nextCursor||''); if(m.node&&m.truncated)workNodes.set(m.node.executionId,Object.assign({},m.node,{truncated:true}));
          if(m.executionId===workSelected){renderWorkTree();renderWorkDetail();if(wasEmpty||wasAtEnd){E.workDetailBody.scrollTop=E.workDetailBody.scrollHeight;scheduleAutoPager(maybeAutoMoreWorkDetail);}}
        }
        else if(m.t==='execution_connection'){ if(m.runnerId)workConnections.set(m.runnerId,m.state);renderWorkConnection();if(workSelected&&(workNodes.get(workSelected)||{}).runnerId===m.runnerId)renderWorkDetail(); }
        else if(m.t==='execution_control_result'||m.t==='execution_input_result'||m.t==='execution_archive_result'){
          const unsupported=Array.isArray(m.unsupportedIds)?m.unsupportedIds.length:0; toast(m.ok?(unsupported?`⚠ Atualizado parcialmente · ${unsupported} sem suporte`:'✓ Trabalho atualizado'):('⚠ '+(m.error||'Não foi possível atualizar o trabalho.')));
          if(m.executionId)tx({t:'execution_open',executionId:m.executionId,limit:500});
        }
        else if(m.t==='execution_error'){ const msg=m.message||m.code||'Falha ao carregar trabalhos'; if(m.executionId)workTranscriptLoading.delete(m.executionId); if(!m.executionId){workLoadError=String(msg);workLoadingMore=false;E.workMore.disabled=false;E.workMore.textContent='Tentar novamente';renderWorkTree();} if(m.executionId===workSelected)E.workDetailBody.insertAdjacentHTML('afterbegin',`<div class="worknotice err">${esc(String(msg))}</div>`); else toast('⚠ '+msg); }
        else if(m.t==='update_status'){ updState=m.status; renderUpdate(); }
        else if(m.t==='update_progress'){ if(E.updStatus) E.updStatus.textContent='… '+(m.message||'atualizando'); toast('🔄 '+(m.message||''));
          // Machine snapshots carry the durable queue keyed by runner id. Do not synthesize rows by
          // label here: the next snapshot would add the same machine under its id and duplicate it.
          updMach={}; renderUpdMachines(); }
        else if(m.t==='update_machine'){ const pending=['queued','sent','awaiting_restart'].includes(m.state), verified=m.verified||m.state==='verified'; updMach[m.runnerId]={label:m.label,dirty:m.dirty,
            state:verified?'verified':(pending?m.state:(m.ok?'ok':(m.dirty?'blocked':'fail'))),
            why:verified?'reiniciou e versão confirmada':m.state==='queued'?'offline — atualização guardada':m.state==='sent'?'drenando e preparando':m.state==='awaiting_restart'?'preparada — aguardando reconexão':m.ok?(m.behind?'atualizada, reiniciando':'dependências verificadas'):(m.dirty?'repo sujo':(m.log||'').split(String.fromCharCode(10))[0].slice(0,60))};
          renderUpdMachines(); }
        else if(m.t==='update_result'){ if(m.ok){ toast('✅ '+((m.log||'atualizado').split('\n').pop()||'').slice(0,80)); } else { toast('⚠ Falha: '+(m.log||'').slice(0,120)); if(E.updStatus) E.updStatus.textContent='⚠ '+(m.log||'').slice(0,140); E.updActions.classList.remove('hidden'); } }
        else if(m.t==='unauth'){ if(m.reason==='token inválido'){ authToken=''; localStorage.removeItem('jarvis_token'); } gateError(m.error||m.reason||''); showGate(m.claimed); }
        else if(m.t==='hello'){ caps=m.agents||[]; if(!cfg.agent){cfg.agent=m.default;saveCfg();} enter(); }
        else if(m.t==='command_list'){ cmdList=m.commands||[]; cmdListFor=(m.runnerId||routedMachine||currentMachine||'local')+'|'+(m.cwd||curCwd||''); cmdReqPending=false; if(trigOpen()&&trigMode==='cmd') updateTrig(); }
        else if(m.t==='mention_list'){ fileList=m.files||[]; if(trigOpen()&&trigMode==='file'){ trigItems=fileList.slice(0,50); trigIdx=trigItems.length?0:-1; renderTrig(); } }
        else if(m.t==='machines'){ machines=m.machines||[]; machines.forEach(mm=>{ const u=mm.updatePending;if(!u){const prior=updMach[mm.id];if(prior&&['queued','sent','awaiting_restart'].includes(prior.state)&&mm.online&&!mm.stale)updMach[mm.id]={label:mm.label,state:'verified',why:'reiniciou e versão confirmada'};return;} const state=u.state||'queued';updMach[mm.id]={label:mm.label,state,dirty:state==='blocked',why:state==='blocked'?(u.lastError||'atualização bloqueada'):state==='awaiting_restart'?'preparada — aguardando reconexão':state==='sent'?'solicitação entregue':(mm.online?'aguardando nova tentativa':'offline — atualização guardada')};}); renderUpdMachines(); renderUpdate(); renderMachines(); updateOfflineBanner(); if(currentMachine==='all') tx({t:'listAll'}); if(!E.secModal.classList.contains('hidden')) tx({t:'sec_state'}); if(E.settings&&!E.settings.classList.contains('hidden')&&authUser&&authUser.role==='owner') fillRoutineMachines();
          // restaura a máquina remota selecionada antes do reload (senão volta pro servidor)
          if(restoringMachine){ if(machines.some(x=>x.id===currentMachine)){ tx({t:'runner',runnerId:currentMachine}); } else { restoringMachine=false; currentMachine='local'; try{localStorage.removeItem('jarvis_machine');}catch{} } } }
        else if(m.t==='filecontent'){ showFile(m); }
        else if(m.t==='filediff'){ showDiff(m); }
        else if(m.t==='dirs'){ browsePath=m.path; if(popMode==='folder'){ const path=document.getElementById('popPath'),list=document.getElementById('popList'),up=document.getElementById('popUp');
          if(path){ path.textContent=m.path; if(up) up.dataset.parent=m.parent||''; list.innerHTML=''; (m.entries||[]).forEach(name=>{ const d=document.createElement('div'); d.textContent='📁 '+name; d.onclick=()=>tx({t:'listdir',runnerId:browseRunner,path:m.path.replace(/[\\/]$/,'')+(m.path.includes('\\')?'\\':'/')+name}); list.appendChild(d); }); } } }
        else if(m.t==='cron_validation'){ if(String(m.cron||'').trim()!==(E.rtCron.value||'').trim())return; cronOk=!!m.ok; E.rtAdd.disabled=!cronOk; E.rtCronHelp.className='cron-help '+(cronOk?'ok':'err'); E.rtCronHelp.textContent=cronOk?('✓ '+m.description+' · '+m.expression+' · fuso '+routineTimezone):('⚠ '+m.error); }
        else if(m.t==='sessions'){
          // visão unificada: só o agregado (runnerId 'all') alimenta a lista; listas de máquina única
          // que chegam por troca de runner (ao abrir) são ignoradas aqui pra não sobrescrever o agregado.
          if(currentMachine==='all'){ if(m.runnerId!=='all') return; } else if(m.runnerId && m.runnerId!==currentMachine) return;
          restoringMachine=false; sessions=dedupeSessionsList(m.sessions||[]); recentDirs=m.recentDirs||recentDirs;
          if(lastBump && Date.now()-lastBump.ts<12000){ const bi=sessions.findIndex(s=>s.id===lastBump.sid&&(currentMachine!=='all'||(s.runnerId||'local')===lastBump.runner)); if(bi>0){ const [bs]=sessions.splice(bi,1); sessions.unshift(bs); } }  // preserva o topo recém-enviado
          renderRecents(); if(!currentSession && !creatingSession && currentMachine!=='all'){
          const exists=(id)=> !!id && sessions.some(s=>s.id===id);
          const last=lastByMachine[currentMachine], h=hashSession();
          const pick = exists(last)?last : (exists(h)?h : (sessions.find(s=>!isNative(s.id))||{}).id);
          if(pick) openSession(pick,currentMachine);
          else if(currentMachine==='local' && !hashSession()) E.newSess.onclick(); } }
        else if(m.t==='history'){
          const historyRunner=m.runnerId||selectedRunner(), historyKey=sessionStateKey(m.sessionId,historyRunner); cacheHist({...m,runnerId:historyRunner});
          if(historyRunner!==selectedRunner()&&historyKey!==openingSession)return;
          if(openingSession&&historyKey!==openingSession)return;
          if(currentSession && (m.sessionId!==currentSession||historyRunner!==currentSessionRunner)) return;
          openingSession=null; creatingSession=false; applyHistory(m);
        }
        else if(m.t==='message'){ const runner=frameRunner(m); if(m.message.role==='assistant') clearRestorable(m.message.sessionId,runner); if(currentFrame(m,m.message.sessionId)){ if(m.message.role==='assistant') clearPending(); if(!(m.message.role==='user'&&consumeOptimisticUser(m.message.sessionId,m.message))) addMsg(m.message); if(m.message.role==='user'&&!curStarted){ curStarted=true; renderControls(); } } }
        else if(m.t==='queue'){ const runner=m.runnerId||selectedRunner(); queueBySession[sessionStateKey(m.sessionId,runner)]=(m.items||[]).map(x=>({text:x.text,atts:x.atts||[]})); if(m.sessionId===currentSession&&runner===currentSessionRunner) renderQueue(); }
        else if(m.t==='auto_route'&&currentFrame(m)){ if(m.state==='started'){ status('busy','Escolhendo IA, modelo e esforço…'); }
          else if(m.state==='cancelled'){ status(''); clearPending(); onTurnEnd(m.sessionId,frameRunner(m)); }
          else { const d=m.decision||{}; status(''); if(d.agent)currentAgent=d.agent; sessDeclModel=d.model||null; sessDeclEffort=d.effort||null; lastRouteReason=d.reason||''; syncModelEffort(); if(d.fallback)toast('⚠ Automático: '+(d.reason||'usado o padrão compatível')); } }
        else if(m.t==='asking'){ const k=askStateKey(m.sessionId,m.runnerId); if(m.on) askingSids.add(k); else askingSids.delete(k); if(currentFrame(m)){ if(m.on&&!busy(currentSession)) status('busy','Consolidando o resultado…'); else if(!askActive) status(''); refreshComposer(); } renderRecents(); }
        else if(m.t==='ask'){ askingSids.delete(askStateKey(m.sessionId,m.runnerId)); saveAsk(m.sessionId,m.questions||[],m.runnerId); if(m.sessionId===currentSession&&(m.runnerId||selectedRunner())===currentSessionRunner){ status(''); renderAskCard(m.questions||[],m.runnerId); refreshComposer(); } else { unread.add(sessionStateKey(m.sessionId,m.runnerId)); renderRecents(); } }
        else if(m.t==='ask_cleared'){ askingSids.delete(askStateKey(m.sessionId,m.runnerId)); clearAsk(m.sessionId,m.runnerId); if(currentFrame(m)){ if(askActive){try{askActive.card.remove();}catch(e){} askActive=null;askVoice=false;} status('');refreshComposer(); } }
        else if(m.t==='agent_event'){ if(!currentFrame(m))return; const ev=m.event||{};
          if(liveTurnId!==ev.turnId){ liveTurnId=ev.turnId; seenAgentEvents.clear(); }
          if(ev.eventId&&seenAgentEvents.has(ev.eventId))return; if(ev.eventId){seenAgentEvents.add(ev.eventId);if(seenAgentEvents.size>1200)seenAgentEvents.delete(seenAgentEvents.values().next().value);}
          if(ev.kind==='accepted'||ev.kind==='started') streamStartUI(ev.at);
          else if(ev.kind==='thinking') streamThinking(ev.text,ev.parentId,ev.executionId);
          else if(/^tool_/.test(ev.kind)&&ev.tool){ const t=ev.tool; streamTool(t.name,t.summary,t.callId,t.parentId,t.path,t.adds,t.dels,t.rows,t.detail,t.status,t.error,ev.executionId); if(t.path)touchFile(t.path,/Edit$|^Write$/.test(t.name)?(t.name==='Write'?'write':'edit'):'read',t.adds,t.dels); }
          else if(ev.kind==='text_delta'||ev.kind==='text_block'){ clearRestorable(m.sessionId); streamText(ev.text||'',ev.parentId||(ev.tool&&ev.tool.parentId),ev.executionId); }
          else if(ev.kind==='plan') streamTool('Plan',ev.plan&&ev.plan.title||ev.text||'Plano atualizado',null,null,null,0,0,null,null,'completed');
          else if(ev.kind==='usage'){ turnUsage=ev.usage||turnUsage; if(ev.usage){E.usage.textContent=usageSummary(ev.usage);if(ev.usage.contextTokens||ev.usage.inputTokens)lastInputTokens=ev.usage.contextTokens||ev.usage.inputTokens;if(ev.usage.contextWindowTokens)lastContextWindow=ev.usage.contextWindowTokens;if(ev.usage.model)sessDeclModel=ev.usage.model;if(ev.usage.effort)sessDeclEffort=ev.usage.effort;renderControls();updUsagePill();} }
          else if(ev.kind==='completed'){ clearRestorable(m.sessionId,frameRunner(m)); if(typeof m.sessionCost==='number'){sessCost=m.sessionCost;sessUsage=m.sessionUsage||sessUsage;} streamDone(ev.text,turnUsage); onTurnEnd(m.sessionId,frameRunner(m)); }
          else if(ev.kind==='cancelled'){ streamCancelled(ev.text); onTurnEnd(m.sessionId,frameRunner(m)); }
          else if(ev.kind==='failed'){ streamErr(ev.text); onTurnEnd(m.sessionId,frameRunner(m)); } }
        else if(m.t==='stream'){ if(!currentFrame(m))return; const ev=m.ev||{};
          if(ev.kind==='start') streamStartUI();
          else if(ev.kind==='thinking') streamThinking(ev.text);
          else if(ev.kind==='tool'){ streamTool(ev.name,ev.summary,ev.toolId,ev.parentId,ev.path,ev.adds,ev.dels,ev.rows,ev.detail,null,null,ev.executionId); if(ev.path) touchFile(ev.path, /Edit$|^Write$/.test(ev.name)?(ev.name==='Write'?'write':'edit'):'read', ev.adds, ev.dels); }
          else if(ev.kind==='text'){ clearRestorable(m.sessionId); streamText(ev.text||'',ev.parentId,ev.executionId); }
          else if(ev.kind==='done'){ clearRestorable(m.sessionId,frameRunner(m)); if(typeof m.sessionCost==='number'){sessCost=m.sessionCost;sessUsage=m.sessionUsage||sessUsage;} streamDone(ev.text, m.usage); onTurnEnd(m.sessionId,frameRunner(m)); }
          else if(ev.kind==='cancelled'){ streamCancelled(); onTurnEnd(m.sessionId,frameRunner(m)); }
          else if(ev.kind==='error'){ streamErr(); onTurnEnd(m.sessionId,frameRunner(m)); } }
        else if(m.t==='activity'){ if(!currentFrame(m))return;
          // espelho ao vivo de uma sessão nativa: o evento já é uma ação CONCLUÍDA (o tail lê o que
          // foi escrito) → tool row completo (done): "Editado", contagem +/-, abrir arquivo, diff.
          const d=toolRowEl(m.name,m.summary||m.name||'',m.path,m.adds,m.dels,true,m.rows,m.detail);
          if(m.path) touchFile(m.path, /Edit$|^Write$/.test(m.name)?(m.name==='Write'?'write':'edit'):'read', m.adds, m.dels);
          if(pendingEl)E.log.insertBefore(d,pendingEl);else E.log.appendChild(d); autoScroll(); }
        else if(m.t==='usage'){ if(currentFrame(m)&&m.usage){ E.usage.textContent=usageSummary(m.usage); if(m.usage.contextTokens||m.usage.inputTokens)lastInputTokens=m.usage.contextTokens||m.usage.inputTokens;if(m.usage.contextWindowTokens)lastContextWindow=m.usage.contextWindowTokens;updUsagePill(); } }
        else if(m.t==='usage_info'){ planUsage=m.plan||null; planStatus=m.planStatus||null; planKey=(m.runnerId||'local')+'\0'+(m.agent||''); if(typeof m.total==='number') costTotalAll=m.total; if(popMode==='usage'){ renderPlan(planUsage); const sc=document.getElementById('usessc'); if(sc) sc.innerHTML=sessCostRow(); } }
        else if(m.t==='session'){ if(currentFrame(m) && m.nativeId && !curNative){ curNativeId=m.nativeId; renderNativeChip(); } }
        else if(m.t==='deleted'){ const deleted=Array.isArray(m.ids)?m.ids:[], inCur=deleted.includes(currentSession);
          if(inCur){ currentSession=null; clearQueue(); E.log.innerHTML=''; E.title.textContent='—'; curNativeId=''; renderNativeChip(); setHash(''); }
          deleted.forEach(id=>{ const key=sessionStateKey(id,sessionRunner()); if(sessionPrefs[key])delete sessionPrefs[key]; if(sessionRunner()==='local'&&sessionPrefs[id])delete sessionPrefs[id]; }); saveSessionPrefs();
          if(!m.ok) toast(t('tDelFail')); }
        else if(m.t==='tts'){ if(m.for==='ask'){ if(!m.sessionId||currentFrame(m))askVoicePlayAndListen(m.audio); } else if(currentFrame(m)) playTTS(m.audio); }
        else if(m.t==='ask_choice'){ askVoiceApply(m); }
        else if(m.t==='searchResult'){ clearPending();
          if(m.hits!==undefined){ if(!E.searchModal.classList.contains('hidden') && m.query===E.searchInput.value.trim()) renderHits(E.searchResults,m); }   // filtro literal digitado (ignora resposta obsoleta)
          else if(!E.searchModal.classList.contains('hidden')) renderSearchInto(E.searchResults,m); else addSearchCard(m); }   // busca falada (LLM + áudio)
        else if(m.t==='memory_result'){ if(E.searchModal.classList.contains('hidden'))return;
          if(m.error){ E.searchResults.innerHTML='<div class="mut">'+esc(m.error)+'</div>'; return; }
          const hits=(m.hits||[]).map(h=>({id:h.id,runnerId:h.runnerId,title:h.title,agent:h.agent,cwd:h.cwd,where:'content',snippet:'['+(h.score||0)+'%] '+(h.snippet||'')}));
          renderHits(E.searchResults,{query:m.query,hits,done:true}); if(m.stats){ const ps=(m.stats.projects||[]).slice(0,3).map(p=>p.projectKey+' ('+p.count+')').join(' · '), d=document.createElement('div'); d.className='mut'; d.style.cssText='font-size:11.5px;margin-top:6px'; d.textContent='Memória: '+(m.stats.total||0)+' itens'+(ps?' · '+ps:''); E.searchResults.appendChild(d); } }
        else if(m.t==='memory_preview'){ status(''); showMemoryPreview(m); }
        else if(m.t==='memory_cancelled'){ if(m.token&&memoryPreviewToken&&m.token!==memoryPreviewToken)return; status(''); E.memoryCancel.disabled=false;
          if(m.ok){ E.memoryModal.classList.add('hidden'); E.memoryApply.disabled=false; memoryPreviewToken=''; memoryPreviewNote=''; toast('Prévia descartada'); }
          else toast(m.error||'Não foi possível descartar a prévia'); }
        else if(m.t==='memory_applied'){ const related=memoryApplyToken||memoryPreviewToken; if(m.token&&related&&m.token!==related)return; const note=memoryApplyToken===m.token?memoryApplyNote:memoryPreviewNote;
          status(''); E.memoryModal.classList.add('hidden'); E.memoryCancel.disabled=false; E.memoryApply.disabled=false; memoryPreviewToken=''; memoryApplyToken=''; memoryPreviewNote=''; memoryApplyNote='';
          if(m.ok){ toast('Memória gravada'); if(note&&E.input.value.replace(/^#+\s*/,'').trim()===note){ E.input.value=''; E.input.style.height='auto'; if(currentSession){ delete draftBySession[sessionStateKey(currentSession,currentSessionRunner)]; saveDrafts(); } } }
          else { toast(m.error||'Não foi possível gravar a memória'); } }
        else if(m.t==='memory_stats'){ toast('Memória: '+((m.stats&&m.stats.total)||0)+' itens.'); }
        else if(m.t==='memory_reindexed'){ toast('✓ Memória reindexada: '+(m.count||0)+' sessões.'); }
        else if(m.t==='stage'){ if(currentFrame(m)){ if(m.done){ hideStage(); } else showStage({draft:m.draft,say:m.say}); } }
        else if(m.t==='stage_heard'){ if(currentFrame(m)&&stageEl) showStage({heard:m.text}); }
        else if(m.t==='stage_escalate'){ if(currentFrame(m))showStage({escalate:true,reason:m.reason}); }
        else if(m.t==='stage_say'){ /* falado via tts; sem UI extra */ }
        else if(m.t==='canvas'){ renderCanvas(m); }
        else if(m.t==='summary'){ endVoiceOp(); status(''); if(m.audio) playAudioOnce(m.audio); if(m.text) toast('🔊 '+m.text); }
        else if(m.t==='busy'){ endVoiceOp(); clearPending(); status(''); toast('⏳ '+(m.message||'Já estou gerando um áudio — aguarde.')); }
        else if(m.t==='voice_ignored'){ endVoiceOp(); clearPending(); status(''); toast(t('tVoiceIgnored')); }
        else if(m.t==='queued'){ const runner=frameRunner(m); endVoiceOp(); justSent.delete(sessionStateKey(m.sessionId,runner)); const msg=m.message||(m.update?'Atualização em andamento — mensagem ficou na fila.':'Mensagem na fila — aguardando o turno atual terminar'); refreshComposer(); if(currentFrame(m)){ clearPending(); status('busy',msg); } toast(m.update?'🔄 '+msg:t('tQueued')); }
        else if(m.t==='voice_timing'){ try{ console.log('[voz] STT '+m.stt+'ms · locutor '+m.speaker+'ms · correção+gate '+m.preflight+'ms'); }catch(e){} }
        else if(m.t==='runs'){ const runner=m.runnerId||selectedRunner(), prev=activeRunsByRunner[runner]||[], now=m.active||[], sent=[...justSent].filter(key=>key.startsWith(runner+'\0')).map(key=>key.slice(runner.length+1)), finished=[...new Set([...prev,...sent])].filter(id=>!now.includes(id)); prev.forEach(id=>{ if(!now.includes(id)&&!(id===currentSession&&runner===currentSessionRunner)) unread.add(sessionStateKey(id,runner)); }); activeRunsByRunner[runner]=now; if(runner===sessionRunner())activeRuns=now; now.forEach(id=>justSent.delete(sessionStateKey(id,runner))); finished.forEach(id=>onTurnEnd(id,runner)); renderRecents(); refreshComposer(); scheduleAllRefresh(); }
        else if(m.t==='qr'){ E.qrImg.src=m.dataUri; E.qrUrl.textContent=m.url; E.qrModal.classList.remove('hidden'); }
        else if(m.t==='pushkey'){ if(pushKeyResolve){ const r=pushKeyResolve; pushKeyResolve=null; r(m.key); } }
        else if(m.t==='wake_state'){ cfg.wake=m.enabled; saveCfg(); if(E.setWake) E.setWake.checked=m.enabled; }
        else if(m.t==='wake_event'){ status('listening', m.phase==='capturing'?'Jarvis ouvindo…':'Jarvis'); }
        else if(m.t==='voice_state'){ speakers=m.speakers||[]; cfg.voiceGate=!!m.gate; saveCfg(); if(E.setGate)E.setGate.checked=cfg.voiceGate; renderSpk(); }
        else if(m.t==='enrolled'){ note('✓ Voz cadastrada: '+m.name+' ('+m.samples+' amostras).'); }
        else if(m.t==='error'){ creatingSession=false; endVoiceOp(); clearPending(); onTurnEnd(currentSession); addErr('erro: '+m.message); if(m.limit){ E.limit.textContent='⚠ Limite de uso atingido: '+m.message; E.limit.classList.remove('hidden'); } } };
    }
    function playTTS(b64){ const b=atob(b64),u=new Uint8Array(b.length); for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);
      const a=new Audio(URL.createObjectURL(new Blob([u],{type:'audio/wav'}))); status('speaking',t('spSpeaking')); ttsPlaying=true; curTtsAudio=a;
      a.onended=()=>{ ttsPlaying=false; curTtsAudio=null; status('');
        if(stagingActive && !recording){ startRec(true); return; }               // refino por voz em andamento → continua ouvindo
        if(askPendingVoice){ askPendingVoice=false; startAskVoice(); return; }   // decisão pendente → wizard de voz
        if(askActive) return;                                                    // card de decisão aberto → não escuta em contínuo
        if((cfg.continue || lastWasVoice) && !recording) startRec(true); };
      a.play().catch(()=>{ ttsPlaying=false; status(''); }); }
    // reprodução única (resumo falado): NÃO re-arma o mic
    function playAudioOnce(b64){ const b=atob(b64),u=new Uint8Array(b.length); for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);
      const a=new Audio(URL.createObjectURL(new Blob([u],{type:'audio/wav'}))); status('speaking',t('spSpeaking')); a.onended=()=>status(''); a.play().catch(()=>status('')); }
    // ---------- voz ambiente: painel de refino (staging) ----------
    let stageEl=null;
    function showStage(m){ stagingActive=true;
      if(!stageEl){ stageEl=document.createElement('div'); stageEl.id='stagePanel';
        stageEl.style.cssText='position:fixed;left:50%;transform:translateX(-50%);bottom:88px;z-index:55;width:min(560px,94vw);background:var(--panel);border:1px solid #a78bfa66;border-radius:14px;padding:12px 14px;box-shadow:0 10px 34px #000b';
        document.body.appendChild(stageEl); }
      renderStage(m||{}); }
    function renderStage(m){ if(!stageEl)return;
      if(m.draft!==undefined) stageEl.dataset.draft=m.draft||'';
      const draft=stageEl.dataset.draft||'';
      let h='<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><b style="color:#a78bfa">🎙 Refino por voz</b><span class="mut" style="font-size:11px">só entra no chat ao confirmar</span></div>';
      if(m.heard) h+='<div class="mut" style="font-size:11.5px;margin-bottom:2px">você: '+esc(m.heard)+'</div>';
      h+='<div style="background:var(--code);border:1px solid var(--line);border-radius:9px;padding:8px 10px;margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere">'+(draft?esc(draft):'<span class="mut">ouvindo…</span>')+'</div>';
      if(m.say) h+='<div class="mut" style="font-size:12px;margin-bottom:6px">🔊 '+esc(m.say)+'</div>';
      if(m.escalate) h+='<div style="color:#f59e0b;font-size:12px;margin-bottom:6px">Precisa de um modelo mais forte'+(m.reason?' ('+esc(m.reason)+')':'')+'. Autorizar?</div>';
      stageEl.innerHTML=h;
      const row=document.createElement('div'); row.className='row'; row.style.cssText='gap:6px;justify-content:flex-end;margin-top:2px';
      const mk=(t,cls,fn)=>{ const b=document.createElement('button'); if(cls)b.className=cls; b.textContent=t; b.style.flex='none'; b.onclick=fn; return b; };
      if(m.escalate){ row.appendChild(mk('Não','ghost',()=>tx({t:'stage_escalate_no',sessionId:currentSession}))); row.appendChild(mk('Sim, usar','',()=>tx({t:'stage_escalate_ok',sessionId:currentSession}))); }
      else { row.appendChild(mk('Cancelar','ghost',()=>{ tx({t:'stage_cancel',sessionId:currentSession}); })); row.appendChild(mk('🎤 Falar','ghost',()=>startRec(false))); row.appendChild(mk('Enviar ✓','',()=>tx({t:'stage_confirm',sessionId:currentSession}))); }
      stageEl.appendChild(row); }
    function hideStage(){ stagingActive=false; stopTTS(); if(stageEl){ stageEl.remove(); stageEl=null; } status(''); }
    function toast(t){ const d=document.createElement('div'); d.className='toast'; d.textContent=t; d.onclick=()=>d.remove(); document.body.appendChild(d); setTimeout(()=>{ if(d.parentNode) d.remove(); },9000); }

    // ---------- mic (manual + continuação hands-free com VAD) ----------
    let rec=null,chunks=[],recording=false,contTimer=null,lastWasVoice=false,discardRec=false;
    async function startRec(auto){ if(recording) return;
      try{ const st=await navigator.mediaDevices.getUserMedia({audio:{noiseSuppression:cfg.noise,echoCancellation:true,autoGainControl:true}}); rec=new MediaRecorder(st); chunks=[]; recording=true;
        // VAD: detecta fala e fim de fala (silêncio após falar) para não gravar o tempo todo
        const ac=new AudioContext(); const src=ac.createMediaStreamSource(st); const an=ac.createAnalyser(); an.fftSize=512; src.connect(an);
        const buf=new Uint8Array(an.fftSize); let spoke=false,silence=0,elapsed=0; const TH=cfg.noise?10:6;
        const poll=setInterval(()=>{ an.getByteTimeDomainData(buf); let mx=0; for(const v of buf) mx=Math.max(mx,Math.abs(v-128)); elapsed+=100;
          if(mx>TH){ spoke=true; silence=0; } else if(spoke){ silence+=100; }
          if(auto && rec.state==='recording'){ if(spoke&&silence>=1100){ rec.stop(); }   // parou de falar -> encerra
                    else if(!spoke&&elapsed>=6000){ rec.stop(); } }                        // ninguém falou em 6s -> desiste
        },100);
        rec.ondataavailable=(e)=>chunks.push(e.data);
        rec.onstop=async()=>{ clearInterval(poll); clearTimeout(contTimer); ac.close(); st.getTracks().forEach(t=>t.stop()); recording=false; E.mic.classList.remove('on'); E.mic.textContent='🎤'; if(E.micCancel)E.micCancel.classList.add('hidden'); status('');
          if(discardRec){ discardRec=false; return; }   // descartado pelo usuário -> nao envia
          if(auto && !spoke) return; // continuação sem fala -> ignora (encerra a conversa hands-free)
          const b64=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result.split(',')[1]);fr.readAsDataURL(new Blob(chunks,{type:'audio/webm'}));});
          // barge-in: falar POR CIMA do agente (ou já em refino) → vai para o staging (refino), não pro chat
          if(ttsPlaying || stagingActive){ stopTTS(); stagingActive=true; showStage({say:'refinando…'}); status('speaking',t('spRefining')); tx({t:'stage_voice',audio:b64,ext:'webm',sessionId:currentSession}); return; }
          if(busy(currentSession)){ toast('⏳ Sessão ocupada — envie o áudio quando terminar.'); return; }   // voz não entra na fila (a fila envia texto)
          lastWasVoice=true; stick=true; bumpSession(currentSession); markJustSent(currentSession); tx({t:'voice',audio:b64,ext:'webm',speak,model:curModel,effort:curEffort,auto:routeAutoFor(currentSession),sessionId:currentSession}); showPending(); refreshComposer(); };
        discardRec=false; rec.start(); E.mic.classList.add('on'); E.mic.textContent='⏺'; if(E.micCancel && !auto)E.micCancel.classList.remove('hidden'); status('listening', auto?t('spListeningAns'):t('spListening'));
        if(auto) contTimer=setTimeout(()=>{ if(rec.state==='recording') rec.stop(); }, Math.max(6,cfg.continueSec)*1000); // teto de segurança
      }catch(e){ addErr('mic erro: '+e.message); recording=false; } }
    E.mic.onclick=()=>{ if(recording){ rec.stop(); } else startRec(false); };
    // Descartar: para a gravacao e NAO envia (comecei a falar besteira / sessao errada).
    E.micCancel.onclick=()=>{ if(!recording||!rec)return; discardRec=true; try{rec.stop();}catch(e){} status(''); };

    // ---------- composer / misc ----------
    E.speak.onclick=()=>{ speak=!speak; cfg.voice=speak; saveCfg(); setSpeakBtn(); };
    function setSide(o){ E.side.classList.toggle('open',o); E.backdrop.classList.toggle('hidden',!o); }
    const closeSide=()=>setSide(false);
    E.menuBtn.onclick=()=>setSide(!E.side.classList.contains('open'));
    E.backdrop.onclick=closeSide; E.sideClose.onclick=closeSide;
    E.log.addEventListener('click',(e)=>{
      if(e.target.classList.contains('copy')){ navigator.clipboard.writeText(e.target.nextElementSibling.textContent); e.target.textContent='copiado'; setTimeout(()=>e.target.textContent='copiar',1200); return; }
      const exec=e.target.closest('.exec'); if(exec){ e.stopPropagation(); if(exec.dataset.runner){ routedMachine=exec.dataset.runner; tx({t:'runner',runnerId:routedMachine}); } tx({t:'sendTo',sessionId:exec.dataset.id,text:exec.dataset.action,speak,model:curModel,effort:curEffort,auto:routeAutoFor(exec.dataset.id)}); openSession(exec.dataset.id,exec.dataset.runner); return; }
      const match=e.target.closest('.match'); if(match){ if(match.dataset.runner){ routedMachine=match.dataset.runner; tx({t:'runner',runnerId:routedMachine}); } openSession(match.dataset.id,match.dataset.runner); return; }
      // file references in the chat (markdown links) must NOT navigate away — open in the panel.
      const a=e.target.closest && e.target.closest('a'); if(a){ const href=a.getAttribute('href')||'';
        if(/^(https?:|mailto:|tel:|#)/i.test(href)) return; // real links pass through
        e.preventDefault(); const norm=s=>s.replace(/\\/g,'/'); const h=norm(href).replace(/^\.\//,''); const base=h.split('/').pop();
        const f=curFiles.find(x=>norm(x.path).endsWith(h)) || curFiles.find(x=>norm(x.path).split('/').pop()===base);
        if(f) openFile(f.path,f.action); else openFile(href); }
    });
    E.attach.onclick=()=>E.file.click();
    const readB64 = f => new Promise(r=>{ const fr=new FileReader(); fr.onload=()=>r(fr.result); fr.readAsDataURL(f); });
    async function addFile(f){ if(f.type&&f.type.startsWith('image/')){ const url=await readB64(f); attachments.push({name:f.name||`colada-${Date.now()}.png`, content:String(url).split(',')[1], image:true, preview:url}); } else { attachments.push({name:f.name,content:await f.text()}); } }
    E.file.onchange=async()=>{ for(const f of E.file.files) await addFile(f); E.file.value=''; renderAttach(); };
    // Ctrl+V de imagem direto no chat (igual ao Claude)
    E.input.addEventListener('paste', async (e)=>{ const its=(e.clipboardData&&e.clipboardData.items)||[]; let got=false;
      for(const it of its){ if(it.kind==='file'&&it.type.startsWith('image/')){ const b=it.getAsFile(); if(b){ got=true; await addFile(b); } } }
      if(got){ e.preventDefault(); renderAttach(); } });
    function renderAttach(){ E.attachRow.innerHTML=''; attachments.forEach((a,i)=>{ const c=document.createElement('span'); c.className='chip'+(a.image?' imgchip':'');
      const rm=()=>{ attachments.splice(i,1); renderAttach(); };
      if(a.image&&a.preview){ c.innerHTML=`<img src="${a.preview}" alt="">`; const im=c.querySelector('img'); if(im) im.onclick=(e)=>{ e.stopPropagation(); openImg(a.preview); }; const x=document.createElement('span'); x.className='rmx'; x.textContent='✕'; x.title='Remover'; x.onclick=(e)=>{ e.stopPropagation(); rm(); }; c.appendChild(x); }
      else { c.textContent='📎 '+a.name+' ✕'; c.onclick=rm; }
      E.attachRow.appendChild(c); }); }
    function stashAttachments(sid,runner){ if(!sid)return; const key=sessionStateKey(sid,runner); if(attachments.length) attachmentsBySession[key]=attachments.slice(); else delete attachmentsBySession[key]; }
    function restoreAttachments(sid,runner){ const saved=sid&&sessionValue(attachmentsBySession,sid,runner); attachments=saved?saved.slice():[]; renderAttach(); }
    // arrastar-e-soltar arquivos/imagens no chat → vira anexo (usa o mesmo addFile do ＋/paste)
    const hasFiles=e=>e.dataTransfer&&Array.from(e.dataTransfer.types||[]).includes('Files');
    let dragDepth=0;
    addEventListener('dragenter',e=>{ if(hasFiles(e)){ e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); } });
    addEventListener('dragover',e=>{ if(hasFiles(e)) e.preventDefault(); });
    addEventListener('dragleave',e=>{ if(hasFiles(e)&&--dragDepth<=0){ dragDepth=0; document.body.classList.remove('dragging'); } });
    addEventListener('drop',async e=>{ dragDepth=0; document.body.classList.remove('dragging');
      const fs=e.dataTransfer&&e.dataTransfer.files; if(fs&&fs.length){ e.preventDefault(); for(const f of fs) await addFile(f); renderAttach(); } });
    // fila de mensagens: enquanto um turno roda, novas mensagens ficam na fila e são
    // enviadas JUNTAS (como uma só) quando o turno atual termina. Cancelável (✕ / limpar).
    // auto-reload: só recarrega quando ocioso (nada rodando, nada na fila, sem gravar áudio)
    let myVer=null, needReload=false;
    function maybeReload(){ if(!needReload)return;
      if(activeRuns.length||justSent.size||recording)return;
      if(Object.values(queueBySession).some(q=>q&&q.length))return;
      toast('🔄 Nova versão — atualizando…'); setTimeout(()=>location.reload(),700); }
    // Fila e "ocupado" são POR SESSÃO. A verdade de quem está rodando é o servidor (activeRuns, via
    // {t:runs}); justSent cobre a janela entre eu enviar e o servidor confirmar. Enfileirar numa
    // sessão NUNCA bloqueia outra: cada uma tem sua fila e seu estado.
    const queueBySession={}, justSent=new Set(), justSentTimers={}, optimisticUsers={};
    // draft do composer POR SESSÃO, persistido — sobrevive ao lock/descarte da aba no mobile (antes
    // era só em memória, então bloquear o telefone perdia o que você estava digitando).
    const draftBySession=(()=>{ try{ return JSON.parse(localStorage.getItem('jarvis_drafts')||'{}'); }catch(e){ return {}; } })();
    function saveDrafts(){ try{ localStorage.setItem('jarvis_drafts', JSON.stringify(draftBySession)); }catch(e){} }
    function stashDraft(){ if(currentSession!=null){ const key=sessionStateKey(currentSession,currentSessionRunner), v=E.input?E.input.value:''; if(v&&v.trim()) draftBySession[key]=v; else delete draftBySession[key]; saveDrafts(); } }
    // Decision state is partitioned by machine + session, so equal provider ids cannot cross runners.
    function askStateKey(sid,runner){ return sessionStateKey(sid,runner); }
    function askStoreKey(sid,runner){ return 'jarvis_ask_'+encodeURIComponent(runner||sessionRunner())+'_'+sid; }
    function saveAsk(sid,q,runner){ if(!sid)return; try{ localStorage.setItem(askStoreKey(sid,runner), JSON.stringify(q||[])); }catch(e){} }
    function clearAsk(sid,runner){ if(!sid)return; try{ localStorage.removeItem(askStoreKey(sid,runner)); }catch(e){} }
    function getAsk(sid,runner){ try{ const s=localStorage.getItem(askStoreKey(sid,runner)); return s?JSON.parse(s):null; }catch(e){ return null; } }
    // Mensagem "em voo" recuperável: se você PARAR antes de vir resposta, ela volta pro input pra
    // editar e reenviar. Persistida (localStorage, TTL 1h) pra sobreviver a reload. Some quando a
    // resposta começa a chegar.
    const RESTORE_TTL=3600000;
    function restorableKey(sid,runner){ return 'jarvis_restore_'+encodeURIComponent(runner||sessionRunner())+'_'+sid; }
    function setRestorable(sid,text,atts,runner){ if(!sid)return; try{ localStorage.setItem(restorableKey(sid,runner),JSON.stringify({text:text||'',atts:atts||[],ts:Date.now()})); }catch(e){} }
    function getRestorable(sid,runner){ if(!sid)return null; try{ const v=JSON.parse(localStorage.getItem(restorableKey(sid,runner))||'null'); if(v&&Date.now()-(v.ts||0)<RESTORE_TTL)return v; }catch(e){} return null; }
    function clearRestorable(sid,runner){ if(!sid)return; try{localStorage.removeItem(restorableKey(sid,runner));if((runner||sessionRunner())==='local')localStorage.removeItem('jarvis_restore_'+sid);}catch(e){} const b=document.getElementById('restorebar'); if(b)b.remove(); }
    function restoreToInput(sid){ const v=getRestorable(sid); if(!v)return; E.input.value=v.text||''; E.input.style.height='auto'; E.input.style.height=E.input.scrollHeight+'px'; if(Array.isArray(v.atts)&&v.atts.length){ attachments=v.atts.slice(); renderAttach(); } clearRestorable(sid); try{E.input.focus();}catch(e){} }
    function showRestoreBar(sid){ if(!getRestorable(sid)||sid!==currentSession)return; const old=document.getElementById('restorebar'); if(old)old.remove();
      const b=document.createElement('div'); b.id='restorebar'; b.className='restorebar';
      const s=document.createElement('span'); s.className='rtxt'; s.textContent='Mensagem não enviada — recupere para editar e reenviar.'; b.appendChild(s);
      const btn=document.createElement('button'); btn.type='button'; btn.className='rback'; btn.textContent='↩ Voltar ao campo'; btn.onclick=()=>restoreToInput(sid); b.appendChild(btn);
      const x=document.createElement('button'); x.type='button'; x.className='rx'; x.title='Descartar'; x.textContent='✕'; x.onclick=()=>clearRestorable(sid); b.appendChild(x);
      E.log.appendChild(b); autoScroll(); }
    function queueOf(sid,runner){ const key=sessionStateKey(sid,runner); return queueBySession[key] || (queueBySession[key]=[]); }
    function busy(sid,runner){ if(!sid)return false; const rid=runner||sessionRunner(); return (activeRunsByRunner[rid]||[]).includes(sid) || justSent.has(sessionStateKey(sid,rid)); }
    function optimisticList(sid,runner){ const key=sessionStateKey(sid,runner); return optimisticUsers[key] || (optimisticUsers[key]=[]); }
    function optimisticMessage(text,atts){
      atts=Array.isArray(atts)?atts:[];
      const images=atts.filter(a=>a&&a.image).map(a=>a.preview||(a.content&&('data:image/*;base64,'+a.content))).filter(Boolean);
      const files=atts.filter(a=>a&&!a.image).map(a=>({name:a.name||'arquivo',content:a.content}));
      return {role:'user',text:text||'(anexo)',images,files};
    }
    function addOptimisticUser(sid,msgId,text,atts){
      if(sid!==currentSession)return;
      const el=buildMsgEl(optimisticMessage(text,atts)); el.classList.add('optimistic'); el.dataset.msgId=msgId;
      const anchor=pendingEl||strEl; if(anchor)E.log.insertBefore(el,anchor); else E.log.appendChild(el);
      optimisticList(sid,currentSessionRunner).push({msgId,text:text||'(anexo)',el}); autoScroll();
    }
    function consumeOptimisticUser(sid,message){
      const list=optimisticList(sid,currentSessionRunner);
      while(list.length&&!list[0].el.isConnected) list.shift();
      const idx=list.findIndex(x=>x.text===(message.text||'(anexo)'));
      if(idx<0)return false;
      const [hit]=list.splice(idx,1); hit.el.classList.remove('optimistic'); delete hit.el.dataset.msgId; return true;
    }
    // "justSent" cobre a janela entre eu ENVIAR e o servidor CONFIRMAR o run (activeRuns, via {t:runs}).
    // Failsafe POR SESSÃO: se em 45s o servidor não confirmar (run perdido — WS caiu, done não chegou),
    // destrava a sessão em vez de deixá-la "executando" pra sempre bloqueando novos envios. NUNCA
    // afeta outra sessão (cada sid tem seu timer); se o run de fato começou (activeRuns), não mexe.
    function markJustSent(sid,runner){ if(!sid)return; const rid=runner||sessionRunner(), key=sessionStateKey(sid,rid); justSent.add(key); clearTimeout(justSentTimers[key]);
      justSentTimers[key]=setTimeout(()=>{ if(justSent.has(key)&&!(activeRunsByRunner[rid]||[]).includes(sid)){ justSent.delete(key); refreshComposer(); renderRecents(); } }, 45000); }
    let curBusy=false;   // reflete busy(currentSession); mantido p/ auto-reload
    function refreshComposer(){ curBusy=busy(currentSession);
      // Hub-owned decision cards are advisory HITL. They stay visible without blocking normal input,
      // voice, or the server queue; a newer turn clears stale questions on every device.
      const running=busy(currentSession), ro=curNative&&!curNativeWritable, block=ro;
      if(E.stopBtn) E.stopBtn.classList.toggle('hidden',!curBusy);
      E.input.disabled=block; E.sendBtn.disabled=block; if(E.mic)E.mic.disabled=block;
      E.input.placeholder=ro?'Sessão nativa — somente leitura':(running?'Turno em andamento — enviar adiciona à fila automática':t('composerPh'));
      renderQueue(); updateStopStatus(); maybeReload(); }
    // id de mensagem p/ idempotência: o runner executa um turnId no máximo uma vez (re-entrega do
    // MESMO frame reusa o id e é ignorada). Cada submit gera um id novo (dois envios = dois turnos).
    const uid=()=>{ try{ return crypto.randomUUID(); }catch(e){ return 'm'+Date.now()+Math.random().toString(36).slice(2,8); } };
    function sendMsgTo(sid,text,atts){ if(!sid)return; const msgId=uid(), body=text||'(anexo)'; lastWasVoice=false;
      if(askActive&&sid===currentSession){ const runner=askActive.runnerId||sessionRunner(); try{askActive.card.remove();}catch(e){} askActive=null; askVoice=false; clearAsk(sid,runner); tx({t:'ask_clear',sessionId:sid}); }
      const askKey=askStateKey(sid); if(askingSids.delete(askKey)) tx({t:'ask_clear',sessionId:sid}); bumpSession(sid); markJustSent(sid);
      if(sid===currentSession){ stick=true; addOptimisticUser(sid,msgId,body,atts||[]); if(!curStarted){ curStarted=true; renderControls(); } showPending(); }
      tx({t:'send',text:body,speak,model:curModel,effort:curEffort,auto:routeAutoFor(sid),sessionId:sid,attachments:atts||[],msgId});
      refreshComposer(); }
    function sendMsg(text,atts){ sendMsgTo(currentSession,text,atts); }   // compat
    // Fim de turno de uma sessão. O FLUSH da fila agora é do SERVIDOR (flushQueue no hub): ele
    // envia a fila acumulada e re-transmite {t:queue}/{t:message}. Aqui só destravamos o composer.
    function onTurnEnd(sid,runner){ if(!sid)return; const rid=runner||sessionRunner(), key=sessionStateKey(sid,rid); justSent.delete(key); delete stopping[key]; if(sid===currentSession&&rid===currentSessionRunner) updateStopStatus(); refreshComposer(); }
    function clearQueue(){ if(currentSession){ queueBySession[sessionStateKey(currentSession,currentSessionRunner)]=[]; tx({t:'clearqueue',sessionId:currentSession}); } refreshComposer(); }
    function renderQueue(){ if(!E.queueRow)return; const q=queueOf(currentSession); E.queueRow.innerHTML=''; E.queueRow.classList.toggle('hidden',!q.length); if(!q.length)return;
      const waiting=busy(currentSession)?'rodam automaticamente quando este turno terminar':'rodam automaticamente agora';
      const hdr=document.createElement('div'); hdr.className='qhdr'; const s=document.createElement('span'); s.textContent='⏳ '+q.length+' na fila — '+waiting; hdr.appendChild(s);
      const acts=document.createElement('div'); acts.className='qacts';
      const clr=document.createElement('button'); clr.type='button'; clr.className='qclr'; clr.textContent='limpar fila'; clr.onclick=()=>{ queueBySession[sessionStateKey(currentSession,currentSessionRunner)]=[]; renderQueue(); tx({t:'clearqueue',sessionId:currentSession}); }; acts.appendChild(clr); hdr.appendChild(acts); E.queueRow.appendChild(hdr);
      const list=document.createElement('div'); list.className='qlist';
      q.forEach((it0,i)=>{ const it=document.createElement('div'); it.className='qitem';
        const atts=it0.atts||[]; const imgs=atts.filter(a=>a.image).length, files=atts.length-imgs;
        const long=(it0.text||'').length>60 || /\n/.test(it0.text||'') || atts.length>0;
        const head=document.createElement('div'); head.className='qhead';
        const tog=document.createElement('button'); tog.type='button'; tog.className='qtog'; tog.textContent=long?'▸':''; tog.title='Expandir'; if(!long)tog.style.visibility='hidden'; head.appendChild(tog);
        const t=document.createElement('span'); t.className='qtext'; t.textContent=it0.text||'(anexo)'; head.appendChild(t);
        if(atts.length){ const a=document.createElement('span'); a.className='qatt'; a.textContent=((imgs?'🖼️ '+imgs+' ':'')+(files?'📎 '+files:'')).trim(); head.appendChild(a); }
        const x=document.createElement('button'); x.type='button'; x.className='qx'; x.title='Remover'; x.textContent='✕'; x.onclick=(e)=>{ e.stopPropagation(); q.splice(i,1); renderQueue(); tx({t:'dequeue',sessionId:currentSession,index:i}); }; head.appendChild(x);
        it.appendChild(head);
        // corpo expansível: texto completo + os anexos que vão junto (imagem com miniatura)
        const body=document.createElement('div'); body.className='qbody hidden';
        if(it0.text){ const ft=document.createElement('div'); ft.className='qfull'; ft.textContent=it0.text.length>2000?it0.text.slice(0,2000)+'… (truncado)':it0.text; body.appendChild(ft); }
        if(atts.length){ const w=document.createElement('div'); w.className='qatts'; atts.forEach(a=>{
          if(a.image && a.content){ const im=document.createElement('img'); im.className='qthumb'; const src=(a.content.startsWith('data:')?a.content:'data:image/*;base64,'+a.content); im.src=src; im.title=a.name||''; im.onclick=(e)=>{ e.stopPropagation(); openImg(src); }; w.appendChild(im); }
          else { const c=document.createElement('span'); c.className='qchip'; c.textContent='📎 '+(a.name||'arquivo'); w.appendChild(c); } });
          body.appendChild(w); }
        it.appendChild(body);
        if(long){ const toggle=(e)=>{ e.stopPropagation(); const op=it.classList.toggle('open'); body.classList.toggle('hidden',!op); tog.textContent=op?'▾':'▸'; tog.title=op?'Recolher':'Expandir'; };
          tog.onclick=toggle; t.onclick=toggle; t.style.cursor='pointer'; }
        list.appendChild(it); });
      E.queueRow.appendChild(list); }
    E.composer.onsubmit=(e)=>{ e.preventDefault(); if(curNative&&!curNativeWritable)return; const text=E.input.value.trim(); if(!text&&!attachments.length)return;
      // "#note" → append to the project memory file (CLAUDE.md/AGENTS.md), confirmed. Not a turn.
      if(text.startsWith('#')){ const note=text.replace(/^#+\s*/,'').trim(); if(!note) return; closeTrig();
        tx({t:'memory_preview',text:note,sessionId:currentSession}); status('busy','Preparando prévia da memória…');
        return; }
      if(text.startsWith('!')) pushBang(text.slice(1).split('\n')[0].trim());   // guarda no histórico do "!"
      const atts=attachments.slice(); E.input.value=''; E.input.style.height='auto'; attachments=[]; if(currentSession) delete attachmentsBySession[sessionStateKey(currentSession,currentSessionRunner)]; renderAttach();
      if(currentSession){ delete draftBySession[sessionStateKey(currentSession,currentSessionRunner)]; saveDrafts(); }   // o texto saiu do composer (enviado/enfileirado) → não é mais rascunho
      if(busy(currentSession)){ queueOf(currentSession).push({text:text||'(anexo)',atts}); renderQueue(); bumpSession(currentSession); tx({t:'enqueue',sessionId:currentSession,text:text||'(anexo)',attachments:atts,model:curModel,effort:curEffort,auto:routeAutoFor(currentSession),msgId:uid()}); return; }
      setRestorable(currentSession,text,atts); sendMsgTo(currentSession,text||'(anexo)',atts); };
    E.stopBtn.onclick=()=>{
      if(askActive){   // interromper a DECISÃO → dispensa o card e devolve o composer pra digitar manualmente
        askVoice=false; askPendingVoice=false;
        try{ const c=askActive.card; const nav=c.querySelector('.asknav'); if(nav)nav.remove(); c.classList.add('done'); c.classList.remove('min');
          const n=document.createElement('div'); n.className='askhd'; n.textContent='Decisão interrompida — responda manualmente pelo campo abaixo.'; c.appendChild(n); }catch(e){}
        const runner=askActive.runnerId||sessionRunner(); askActive=null; clearAsk(currentSession,runner); tx({t:'ask_clear',sessionId:currentSession}); status(''); refreshComposer(); try{E.input.focus();}catch(e){} return; }
      // Parar um turno em andamento: cancela o agente e — se ainda não veio resposta — devolve a
      // mensagem ao input (ou mostra o botão "voltar" se você já estava digitando). A FILA é
      // preservada (não some mais no parar).
      if(!currentSession)return; tx({t:'cancel',sessionId:currentSession}); justSent.delete(sessionStateKey(currentSession,currentSessionRunner)); askVoice=false; askPendingVoice=false;
      if(getRestorable(currentSession)){
        const b=E.log.querySelectorAll('.msg.me'); const last=b[b.length-1]; if(last)last.remove();   // tira a mensagem cancelada do chat
        cleanCancel=true;                                                                            // o bloco de atividade some sem deixar "interrompido"
        if(!curNative) tx({t:'dropLast',sessionId:currentSession});                                  // hub: tira do store pra não voltar no reload
        if(!E.input.value.trim()) restoreToInput(currentSession); else showRestoreBar(currentSession);
      }
      stopping[sessionStateKey(currentSession,currentSessionRunner)]=true; refreshComposer(); updateStopStatus(); };
    // ---------- composer triggers: "/" commands+skills+mcp · "@" files · "#" memory ----------
    let cmdList=[], cmdListFor=null, cmdReqPending=false;   // "/" catalog (per machine)
    let fileList=[], mentionT=null, fileAt=null, slashAt=null;   // "@" results/debounce/range + "/" range
    const bangHist=(()=>{ try{ return JSON.parse(localStorage.getItem('jarvis_bang')||'[]'); }catch(e){ return []; } })();  // "!" histórico (por dispositivo)
    function pushBang(cmd){ if(!cmd)return; const h=[cmd,...bangHist.filter(x=>x!==cmd)].slice(0,30); bangHist.length=0; bangHist.push(...h); try{ localStorage.setItem('jarvis_bang',JSON.stringify(bangHist)); }catch(e){} }
    let trigMode=null, trigItems=[], trigIdx=-1;            // shared trigger-popover state (distinct from the E.pop popover)
    const slashOn=()=> cfg.slashMenu!==false;               // default ON; the toggle governs ALL trigger popovers
    function cmdCacheKey(){ return (routedMachine||currentMachine||'local')+'|'+(curCwd||''); }
    function requestCommands(){ if(slashOn() && !cmdReqPending){ cmdReqPending=true; tx({t:'commands',sessionId:currentSession}); } }
    function cmdAgentSel(){ const a=currentAgent||''; return a==='claude-code'?'claude':(['codex','gemini','cursor','copilot','opencode','cline','qwen'].includes(a)?a:null); }
    function trigOpen(){ return !E.cmdPop.classList.contains('hidden'); }
    function closeTrig(){ if(trigOpen()){ E.cmdPop.classList.add('hidden'); E.cmdPop.innerHTML=''; } trigMode=null; trigItems=[]; trigIdx=-1; }
    // "/word" after start/space/"(" (up to the cursor); "@frag" = a path fragment before the cursor.
    function slashTok(){ const p=E.input.selectionStart||0, s=E.input.value.slice(0,p), m=/(^|[\s(])\/([\w:.\-]*)$/.exec(s); return m?{tok:m[2],start:m.index+m[1].length,end:p}:null; }
    function atTok(){ const p=E.input.selectionStart||0; const m=/(?:^|\s)@([\w./\-]*)$/.exec(E.input.value.slice(0,p)); return m?{tok:m[1],start:p-m[1].length-1,end:p}:null; }
    function filterCmds(tok){ const q=(tok||'').toLowerCase(); const ag=cmdAgentSel();
      let arr=ag?cmdList.filter(c=>c.agent===ag):[];
      arr=arr.filter(c=> !q || c.name.toLowerCase().includes(q) || (c.description||'').toLowerCase().includes(q));
      arr.sort((a,b)=>{ const ap=a.name.toLowerCase().startsWith(q)?0:1, bp=b.name.toLowerCase().startsWith(q)?0:1; return ap-bp || a.name.localeCompare(b.name); });
      return arr.slice(0,50); }
    const kindBadge=(k)=> k==='skill'?'skill':k==='mcp'?'mcp':k==='builtin'?'built-in':'cmd';
    function renderTrig(){
      if(!trigItems.length){ E.cmdPop.innerHTML='<div class="cmdempty">'+(trigMode==='file'?'Nenhum arquivo.':'Nenhum comando/skill.')+'</div>'; E.cmdPop.classList.remove('hidden'); return; }
      const rows=trigItems.map((it,i)=> trigMode==='file'
        ? '<div class="cmdit'+(i===trigIdx?' sel':'')+'" data-i="'+i+'"><span class="cn">📄 '+esc(it)+'</span></div>'
        : '<div class="cmdit'+(i===trigIdx?' sel':'')+'" data-i="'+i+'"><span class="cn">/'+esc(it.name)+'</span><span class="ck">'+kindBadge(it.kind)+'</span><span class="cd">'+esc(it.description||it.argHint||'')+'</span></div>');
      E.cmdPop.innerHTML='<div class="cmdhint">↑↓ navegar · Enter/Tab inserir · Esc fechar</div>'+rows.join(''); E.cmdPop.classList.remove('hidden');
      E.cmdPop.querySelectorAll('.cmdit').forEach(el=>{ el.onclick=()=>selectTrig(+el.dataset.i); });
      const s=E.cmdPop.querySelector('.cmdit.sel'); if(s) s.scrollIntoView({block:'nearest'}); }
    function openCmd(tok){
      if(cmdListFor!==cmdCacheKey()){ requestCommands(); E.cmdPop.innerHTML='<div class="cmdempty">Carregando…</div>'; E.cmdPop.classList.remove('hidden'); trigItems=[]; trigIdx=-1; return; }
      trigItems=filterCmds(tok); trigIdx=trigItems.length?0:-1; renderTrig(); }
    function openMention(tok){
      clearTimeout(mentionT); mentionT=setTimeout(()=>{ if(trigMode==='file') tx({t:'mention', q:tok}); }, 120);
      const q=(tok||'').toLowerCase();
      trigItems=fileList.filter(f=>!q||f.toLowerCase().includes(q)).slice(0,50); trigIdx=trigItems.length?0:-1;
      if(!trigItems.length && !fileList.length){ E.cmdPop.innerHTML='<div class="cmdempty">Buscando arquivos…</div>'; E.cmdPop.classList.remove('hidden'); return; }
      renderTrig(); }
    // "#"/"!" agem só no INÍCIO da mensagem (é onde o servidor os trata) → mostram um hint (e o "!" o histórico).
    function openMem(){ trigItems=[]; trigIdx=-1;
      const ag=cmdAgentSel(); const mf=ag==='claude'?'CLAUDE.md':ag==='gemini'?'GEMINI.md':'AGENTS.md'; E.cmdPop.innerHTML='<div class="cmdhint">📝 Anexar à memória do projeto ('+mf+') — Enter confirma · Esc cancela</div>';
      E.cmdPop.classList.remove('hidden'); }
    function openBang(frag){ const q=frag.toLowerCase();
      trigItems=bangHist.filter(c=>!q||c.toLowerCase().includes(q)).slice(0,20); trigIdx=trigItems.length?0:-1;
      const hint='<div class="cmdhint">⚡ Rodar no terminal e injetar a saída — Enter roda · Esc cancela'+(trigItems.length?' · Tab usa o histórico':'')+'</div>';
      const rows=trigItems.map((c,i)=>'<div class="cmdit'+(i===trigIdx?' sel':'')+'" data-i="'+i+'"><span class="cn">! '+esc(c)+'</span></div>');
      E.cmdPop.innerHTML=hint+rows.join(''); E.cmdPop.classList.remove('hidden');
      E.cmdPop.querySelectorAll('.cmdit').forEach(el=>{ el.onclick=()=>selectTrig(+el.dataset.i); });
      const s=E.cmdPop.querySelector('.cmdit.sel'); if(s) s.scrollIntoView({block:'nearest'}); }
    function updateTrig(){
      if(!slashOn()){ closeTrig(); return; }
      const st=slashTok(); if(st){ trigMode='cmd'; slashAt=st; openCmd(st.tok); return; }
      const at=atTok(); if(at){ trigMode='file'; fileAt=at; openMention(at.tok); return; }
      const h=/^\s*([#!])([\s\S]*)$/.exec(E.input.value);
      if(h){ if(h[1]==='#'){ trigMode='mem'; openMem(); } else { trigMode='bang'; openBang((h[2].split('\n')[0]||'').trim()); } return; }
      closeTrig(); }
    function moveTrig(d){ if(!trigItems.length)return; trigIdx=(trigIdx+d+trigItems.length)%trigItems.length; renderTrig(); }
    function selectTrig(i){ const it=trigItems[i]; if(it==null)return;
      if(trigMode==='bang'){ const v=E.input.value; const nl=v.indexOf('\n'); E.input.value='!'+it+(nl===-1?'':v.slice(nl)); closeTrig(); E.input.dispatchEvent(new Event('input')); try{E.input.focus();}catch(e){} return; }
      if(trigMode==='file'){ const at=fileAt||atTok(); if(!at){ closeTrig(); return; } const v=E.input.value; E.input.value=v.slice(0,at.start)+it+' '+v.slice(at.end); closeTrig(); E.input.dispatchEvent(new Event('input')); try{E.input.focus();}catch(e){} return; }
      // cmd mode: replace just the "/tok" with "/name " (keeps surrounding text intact)
      const at=slashAt||slashTok()||{start:0,end:E.input.value.length}; const v=E.input.value;
      E.input.value=v.slice(0,at.start)+'/'+it.name+' '+v.slice(at.end); closeTrig(); E.input.dispatchEvent(new Event('input')); try{E.input.focus();}catch(e){} }

    E.input.oninput=()=>{ E.input.style.height='auto'; E.input.style.height=E.input.scrollHeight+'px'; if(currentSession) draftBySession[sessionStateKey(currentSession,currentSessionRunner)]=E.input.value; updateTrig(); };
    E.input.onkeydown=(e)=>{
      if(trigOpen()){
        if(e.key==='ArrowDown'){ e.preventDefault(); moveTrig(1); return; }
        if(e.key==='ArrowUp'){ e.preventDefault(); moveTrig(-1); return; }
        if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); closeTrig(); return; }
        if(e.key==='Tab' && trigIdx>=0){ e.preventDefault(); selectTrig(trigIdx); return; }
        // Enter só INSERE em / e @ (listas de escolha). Em ! e # o Enter deve RODAR/CONFIRMAR (cai no submit).
        if(e.key==='Enter'&&!e.shiftKey && (trigMode==='cmd'||trigMode==='file') && trigIdx>=0){ e.preventDefault(); selectTrig(trigIdx); return; }
      }
      if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); E.composer.requestSubmit(); } };
    // mobile: o WS costuma cair em background — ao voltar pra aba, reconecta (onopen re-inscreve + recupera)
    document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden'){ stashDraft(); return; }   // vai esconder (lock/background) → salva o draft ANTES de um possível descarte da aba
      if(document.visibilityState==='visible' && (!ws||ws.readyState>1)){ if(reconnectT){clearTimeout(reconnectT);reconnectT=null;} connect(); } });
    window.addEventListener('pagehide', stashDraft);   // último recurso antes do unload/descarte
    setSpeakBtn(); connect();
