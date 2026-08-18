    // Register the service worker on every load (not just when push is enabled) so the app shell is
    // cached and opens OFFLINE — a dropped Tailscale link no longer yields a blank page. Caching is
    // network-first for the HTML, so an online reload still deploys the latest UI (see web/sw.js).
    try {
      const cap = window.Capacitor;
      if (cap && (cap.isNativePlatform?.() || /^(android|ios)$/.test(cap.getPlatform?.() || ''))) {
        const platform = String(cap.getPlatform?.() || '').toLowerCase();
        const html = document.documentElement;
        html.classList.add('native-shell','native');
        if (/^(android|ios)$/.test(platform)) html.classList.add('native-' + platform);
      }
    } catch {}
    try {
      if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      }
    } catch {}
    const $ = (id) => document.getElementById(id);
    const E = ['log','dot','title','roBanner','offlineBar','aiBtn','agentBtn','agentName','cwdBtn','cwdName','modelBtn','modelName','effortBtn','effortName','usageBtn','usageName','pop','speak','recents','moreBtn','files',
      'newSess','searchBtn','digestBtn','workBtn','workBadge','personalBtn','treeBtn','treePanel','treeClose','treeRootPath','treeBody','workPanel','workClose','workBack','workMax','workLive','workTree','workMachine','workSession','workAgent','workCrumb','workNodeTitle','workNodeState','workDetailBody','workMore','workNew','workAnnounce','termBtn','termMenuBtn','termPanel','termTabs','termBody','termEmpty','termMeta','termNew','termMax','termClose','fleetBody','solutionBtn','solutionName','solutionBar','solBarMode','solBarMeta','solBarOff','solutionChars','canvasModal','canvasTitle','canvasBody','canvasClose','sumHdr','tabRec','tabFiles','recPane','filesPane','recCnt','filesCnt','filesMore','qrImg','qrUrl','searchModal','searchInput','searchResults','searchGo','searchClose','smLiteral','smSemantic','semanticScope','memScopeProject','memScopeAll','memReindex','memoryModal','memoryTarget','memoryNote','memoryMeta','memoryCancel','memoryApply','personalModal','personalModalTitle','personalClose','personalPurpose','personalQuery','personalRun','personalLocate','personalQueryStatus','personalReference','personalReferenceHint','personalRegionRow','personalRegion','personalRegionResolve','personalRegionResults','personalViewList','personalViewMap','personalResults','personalMap','personalDiagnostics','personalDiagnosticsCount','personalDiagnosticsBody','personalCalendarEditModal','personalCalendarEditHeading','personalCalendarEditClose','personalCalendarEditTitle','personalCalendarEditStart','personalCalendarEditEnd','personalCalendarEditLocation','personalCalendarEditDescription','personalCalendarEditCancel','personalCalendarEditPreview','personalActionModal','personalActionTitle','personalActionRisk','personalActionState','personalActionPreview','personalActionExpiry','personalActionClose','personalActionCancel','personalActionApprove','personalActionExecute','settingsBtn','settings','settingsHelpBtn','helpSheet','helpSheetTitle','helpSheetBody','helpSheetClose','setSearch','setSearchToggle','setSection','setLang','setAgent','setModel','setEffort','setVoice','voiceCatalog','setContinue','setContinueSec','setSilenceSec','setVoiceAgent','setVoiceModel','setVoiceEffort','setVoiceEscalate','setVoiceRelevance',
      'setWake','setNoise','setPush','setBioLock','setGate','setSlash','personalEnabled','personalPaused','personalContextPolicyAlert','personalLocationMode','personalPrecision','personalSettingsLocate','personalLocationStatus','personalNativeStatus','personalProactiveEnabled','personalProactiveStatus','personalProactivePolicyStatus','personalDisabledKinds','personalQuietStart','personalQuietEnd','personalMaxPerDay','personalCooldown','personalMinScore','personalSave','personalOpenQuery','personalSourceList','personalConsentList','personalSourceForm','personalSourceType','personalSourceLabel','personalSourceEndpoint','personalSourceSecret','personalSourceResources','personalSourceActions','personalSourceHint','personalSourceDiscovery','personalSourceAdvanced','personalSourceCertification','personalSourceFormat','personalSourceAccessRow','personalSourceAccess','personalSourceTimeZone','personalSourceAttribution','personalSourcePurposes','personalSourceArgs','personalSourceCwd','personalSourceAttributes','personalSourceServiceFields','personalSourceOutputSchemaRow','personalSourceOutputSchema','personalSourceEnvGroup','personalSourceEnvName','personalSourceEnvValue','personalSourceEnvAdd','personalSourceEnvList','personalSourceRemoteHttps','personalSourceEnabled','personalSourceSave','personalSourceReset','personalDataSummary','personalDataCategories','personalFavoriteList','personalFavoriteLabel','personalFavoriteAddress','personalFavoriteAliases','personalFavoritePurposes','personalFavoriteLat','personalFavoriteLng','personalFavoriteGeofence','personalFavoriteGeofenceRadius','personalFavoriteEnter','personalFavoriteExit','personalGeofenceStatus','personalFavoriteFindAddress','personalFavoriteAddressResults','personalFavoriteLocationStatus','personalFavoriteLocate','personalFavoriteReset','personalFavoriteSave','personalVehicleList','personalVehicleForm','personalVehicleId','personalVehicleLabel','personalVehicleConnectors','personalVehicleMaxPower','personalVehicleRange','personalVehicleMinPower','personalVehicleOperators','personalVehicleDefault','personalVehicleReset','personalVehicleSave','personalPreferenceList','personalPreferenceKey','personalPreferenceValue','personalPreferencePolarity','personalPreferencePurpose','personalPreferenceExpires','personalPreferenceEditorNote','personalPreferenceReset','personalPreferenceSave','personalObservationsDays','personalDecisionsDays','personalInferencesDays','personalKeepRawLocation','personalRetentionSave','personalExport','personalPrune','personalErase','personalEraseCategory','personalEraseCategoryButton','policySettings','policyNote','setPolicyMode','setPolicyMemoryTarget','setPolicyRisk','setPolicyUnknown','setPolicyCost','setPolicyTokens','setPolicyRepoWrites','setPolicyDiff','setPolicyAutoplay','setPolicyBackground','setPolicyPersonalContext','setPolicyProject','setPolicySession','setPolicyOverrides','pushCfg','pushDone','pushError','pushMachine','pushMode','pushEvery','pushEveryRow','pushStatus','pushRefresh','pushTest','routinesSection','routinesList','rtName','rtPrompt','rtRunner','rtAgent','rtModel','rtEffort','rtCwd','rtBrowse','rtCron','rtCronHelp','rtCronExamples','rtSpeak','rtCancel','rtAdd','spkList','setEnroll','executionSettings','setExecEnabled','setExecRetention','setExecMaxEvents','setExecConcurrency','setExecDepth','setExecDefaultWrite','setExecWorktree','execCfgNote','frameworkSettings','setFwPref','setFwAutoFlow','setFwApplyInstr','fwSeed','fwImport','fwNewFile','fwVersion','fwPublish','fwStatus','fwHealth','fwInventory','fwRefresh','fwLog','fwLogClear','fwEditModal','fwEditTitle','fwEditDirty','fwEditPathRow','fwEditPath','fwEditFinding','fwEditWrap','fwEditGutter','fwEditBody','fwEditDelete','fwEditCancel','fwEditSave','fwEditFmt','fwEditWrapBtn','fwEditMax','fwEditClose','fwEditView','fwDiffModal','fwDiffTitle','fwDiffClose','fwDiffBody','fwZip','fwZipBtn','fwGh','fwGhBtn','fwDir','fwDirBtn','fwTplBtn','fwReset','fwUpdates','fwCatBtn','fwCatalog','fwWfBtn','fwWorkflows','fwSources','fwPreview','fwPreviewTitle','fwPreviewBody','fwPreviewForceRow','fwPreviewForce','fwPreviewMode','fwPreviewApply','fwPreviewCancel','fallbackSettings','fallbackEnabled','fallbackAgent','fallbackModel','fallbackEffort','fallbackSave','fallbackBlocks','logSettings','logEnabled','logLevel','logRetention','logMaxMb','logSave','setCancel','setClose','setX','composer','input','cmdPop','mic','micCancel','attach','file','attachRow','wfRun','wfStepBtn','wfStepName','bgJobs','queueRow','scrollBtn','usage','limit','sendBtn','stopBtn',
      'secRole','secTtl','secGen','secOut','secInvites','secDevices','secRevokeAll',
      'secRunLabel','secRunGen','secRunOut','secRunners',
      'secPassStatus','secPass','secPassRemember','secPassSet','secPassClear','machineBar',
      'setSumAgent','setSumModel','setSumEffort','updStatus','updActions','updAll','updApply','updCheck','updMachines',
      'appUpdBar','appUpdBox','appUpdStatus','appUpdCheck','appUpdInstall',
      'filePanel','fileName','fileMeta','fileBody','fileStat','fileView','fileFmt','fileCopy','fileFull','fileClose','annoSend','annoCount','annoBar','annoSelLbl','annoAdd','annoCancelSel','fileResize','fileResizeV','fileLayoutSw','fileTabs','tabChatBtn','tabFileBtn','nativeChip',
      'designBtn','designPanel','designUrl','designDetect','designOpen','designGrab','designClose','designHost','designCompose','designSel','designCount','designClear','designSelList','designNote','designCoverage','designSend','designCancel','designStatus',
      'imgModal','imgModalPic','imgClose','fileModal','fileModalName','fileModalBody','fileModalClose',
      'dlg','dlgTitle','dlgInput','dlgOk','dlgCancel','sessionInfo','siAvatar','siTitle','siSub','siRows','siCopy','siClose','menuBtn','side','sideClose','backdrop','status','optsBtn','recOptsBtn','recOptsLabel'].reduce((o,k)=>(o[k]=$(k),o),{});
    const MIC_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"></path><path d="M19 11a7 7 0 0 1-14 0"></path><path d="M12 18v3"></path><path d="M8 21h8"></path></svg>';
    const SEND_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path></svg>';
    if(E.mic)E.mic.innerHTML=MIC_ICON;
    if(E.sendBtn)E.sendBtn.innerHTML=SEND_ICON;
    function syncComposerMetrics(){
      try{
        if(!E.composer) return;
        const h=Math.ceil(E.composer.getBoundingClientRect().height);
        if(h>0) document.documentElement.style.setProperty('--composer-height', h+'px');
      }catch(e){}
    }
    function syncViewportMetrics(){
      try{
        const vv=window.visualViewport, h=Math.ceil((vv&&vv.height)||window.innerHeight||0);
        if(h>0) document.documentElement.style.setProperty('--app-height', h+'px');
        // Com o teclado aberto o visualViewport encolhe abaixo do layout viewport. Nesse estado a
        // reserva de safe-area inferior (botões de navegação) é desnecessária — o teclado cobre a
        // barra — e só cria um vão extra acima do teclado. Sinalizamos para o CSS zerar essa reserva.
        const kbOpen=!!vv && (window.innerHeight - h) > 120;
        document.documentElement.classList.toggle('kb-open', kbOpen);
      }catch(e){}
      syncComposerMetrics();
    }
    syncViewportMetrics();
    try{ if(window.ResizeObserver&&E.composer) new ResizeObserver(syncComposerMetrics).observe(E.composer); }catch(e){}
    addEventListener('resize', syncViewportMetrics);
    try{ if(window.visualViewport){ visualViewport.addEventListener('resize',syncViewportMetrics); visualViewport.addEventListener('scroll',syncViewportMetrics); } }catch(e){}
    function setComposerOptionsOpen(open){
      if(!E.composer||!E.optsBtn)return;
      E.composer.classList.toggle('opts-open',!!open);
      E.optsBtn.setAttribute('aria-expanded',open?'true':'false');
      E.optsBtn.title=open?'Fechar opções':'Opções';
      setTimeout(syncComposerMetrics,0);
    }
    if(E.optsBtn)E.optsBtn.onclick=(e)=>{ e.preventDefault(); setComposerOptionsOpen(!E.composer.classList.contains('opts-open')); };
    // hidden file input (created dynamically)
    E.file = document.createElement('input'); E.file.type='file'; E.file.multiple=true; E.file.style.display='none'; document.body.appendChild(E.file);
    // visualizador de imagem (modal) — clicar em qualquer imagem (mensagem, preview do anexo,
    // miniatura da fila) abre aqui; fecha no ✕, no fundo ou com Esc. Nunca abre nova guia.
    function openImg(src){ if(!src)return; E.imgModalPic.src=src; E.imgModal.classList.remove('hidden'); }
    // Ao fechar um modal/overlay, o elemento focado dentro dele vira "órfão" numa subárvore display:none
    // → o teclado não vai a lugar nenhum (o input do chat parece travado até um app-switch refocar a
    // janela). Este helper devolve o foco a um elemento VISÍVEL: o botão de fechar das configurações se
    // elas seguem abertas, senão o compositor do chat. Só age se o foco realmente saiu (dentro do modal
    // fechado ou no body) — nunca rouba foco de outro elemento visível.
    function restoreFocusAfterModal(modalEl){
      try{
        const a=document.activeElement;
        if(a && a!==document.body && !(modalEl&&modalEl.contains(a))) return; // foco já está fora, num visível
        if(a && a.blur) a.blur();                                             // desprende o foco órfão (fix do travamento)
        const fine=window.matchMedia && window.matchMedia('(pointer: fine)').matches;
        if(!fine) return;                                                     // em touch, não força foco (evita abrir teclado)
        const settingsOpen=E.settings && !E.settings.classList.contains('hidden') && modalEl!==E.settings;
        const target=settingsOpen ? (E.setX||E.input) : E.input;
        if(target) target.focus();
      }catch(e){}
    }
    function closeImg(){ E.imgModal.classList.add('hidden'); E.imgModalPic.removeAttribute('src'); restoreFocusAfterModal(E.imgModal); }
    E.imgModal.onclick=(e)=>{ if(e.target===E.imgModal||e.target===E.imgClose) closeImg(); };
    document.addEventListener('keydown',(e)=>{ if(e.key==='Escape'&&!E.imgModal.classList.contains('hidden')){ e.stopPropagation(); closeImg(); } });
    // visualizador de arquivo anexado (não-imagem) — clicar no chip "📎 nome" abre o conteúdo aqui
    // (o mesmo destaque de sintaxe do painel de arquivos). Sem conteúdo (cap de 256KB) → não abre.
    function openAttachedFile(f){ if(!f||f.content==null)return;
      E.fileModalName.textContent=f.name||'arquivo';
      const hl=highlight(f.content||'',f.name); if(hl!=null){ E.fileModalBody.innerHTML=hl; } else E.fileModalBody.textContent=f.content||'';
      E.fileModal.classList.remove('hidden'); }
    function closeFileModal(){ E.fileModal.classList.add('hidden'); E.fileModalBody.innerHTML=''; restoreFocusAfterModal(E.fileModal); }
    E.fileModal.onclick=(e)=>{ if(e.target===E.fileModal) closeFileModal(); };
    E.fileModalClose.onclick=closeFileModal;
    document.addEventListener('keydown',(e)=>{ if(e.key==='Escape'&&!E.fileModal.classList.contains('hidden')){ e.stopPropagation(); closeFileModal(); } });

    let ws, currentSession=null, currentSessionRunner='local', currentAgent=null, caps=[], sessions=[], shown=16, filesShown=12, attachments=[], attachmentsBySession={}, browsePath='', browseRunner='local', browseUse=null, recentDirs=[], curNative=false, curNativeWritable=false, curNativeId='', creatingSession=false;
    const composerMobileMq=window.matchMedia?window.matchMedia('(max-width:760px)'):null;
    function isComposerMobile(){ return composerMobileMq?composerMobileMq.matches:((window.innerWidth||999)>0&&(window.innerWidth||999)<=760); }
    function syncComposerActions(){
      if(!E.composer||!E.sendBtn||!E.mic||!E.input)return;
      const mobile=isComposerMobile(), inputRow=E.input.closest('.inputrow'), controls=E.composer.querySelector('.controls'), pills=E.composer.querySelector('.ctlpills');
      if(mobile&&inputRow&&E.sendBtn.parentNode!==inputRow) inputRow.appendChild(E.sendBtn);
      else if(!mobile&&controls&&E.sendBtn.parentNode!==controls) controls.appendChild(E.sendBtn);
      if(E.attach){
        if(mobile&&inputRow&&E.attach.parentNode!==inputRow) inputRow.insertBefore(E.attach,E.micCancel||E.mic||E.sendBtn);
        else if(!mobile&&pills&&E.attach.parentNode!==pills) pills.insertBefore(E.attach,E.designBtn||pills.firstChild);
      }
      const hasDraft=!!((E.input.value||'').trim()||attachments.length);
      const micActive=E.mic.classList.contains('on');
      E.composer.classList.toggle('has-draft',hasDraft);
      E.sendBtn.classList.toggle('hidden',mobile&&!hasDraft);
      E.mic.classList.toggle('hidden',mobile&&hasDraft&&!micActive);
      // Ponto único onde o chip 🧭 se atualiza: cobre digitação, anexo (muda "pede evidência") e troca
      // de layout. Roda depois do placeholder de refreshComposer, então o hint do passo prevalece.
      try{ renderWfStep(); }catch(e){}
      setTimeout(syncComposerMetrics,0);
    }
    try{ if(composerMobileMq) composerMobileMq.addEventListener('change',syncComposerActions); }catch(e){ try{ composerMobileMq.addListener(syncComposerActions); }catch(_e){} }
    let machines=[], currentMachine=localStorage.getItem('jarvis_machine')||'local', routedMachine='local', lastByMachine={}, restoringMachine=(currentMachine!=='local'&&currentMachine!=='all');
    syncComposerActions();
    // vista "Todas as máquinas": currentMachine==='all' é a VISÃO unificada; routedMachine é a máquina
    // real para onde o hub roteia (definida ao abrir/criar uma sessão da lista agregada). hue por nome.
    // allViewMachines: quem contribuiu para a última agregação — uma máquina offline ou muda deixa de
    // aparecer na lista, e sem este aviso a visão parecia simplesmente "perder sessões" sozinha.
    let allViewMachines=[];
    function machineHue(s){ let h=0; s=String(s||''); for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return h%360; }
    // Versão legível de uma máquina: `git describe` ("v0.5.1-27-g862e9d3") vira "v0.5.1 · +27" (tag +
    // commits à frente) — mostra num relance quão à frente da última release está, o que o sha puro não
    // diz. Exatamente na tag → só "v0.5.1"; sem tag → o sha; "-dirty" vira " *". Runner velho sem build → sha.
    function fmtBuild(build,commit){
      const b=String(build||'').trim(); if(!b) return commit?esc(commit):'';
      const dirty=/-dirty$/.test(b), core=b.replace(/-dirty$/,'');
      const m=core.match(/^(.+)-(\d+)-g[0-9a-f]+$/);
      return esc((m?(m[1]+' · +'+m[2]):core)+(dirty?' *':''));
    }
    let allRefreshT=null; function scheduleAllRefresh(){ if(currentMachine!=='all')return; clearTimeout(allRefreshT); allRefreshT=setTimeout(()=>{ if(currentMachine==='all') tx({t:'listAll'}); }, 1500); }
    const isNative = id => typeof id==='string' && (id.startsWith('claude:')||id.startsWith('codex:'));
    const agentIcon = a => ({'claude-code':'🟣',codex:'🟢',gemini:'🔵',cursor:'⚫',copilot:'🟪',opencode:'🟠',cline:'🔴',qwen:'🔷',continue:'🟡',kiro:'🟤',antigravity:'🛸',aider:'🔹',mock:'⚪'})[a]||'🔹';
    let activeRuns=[]; const activeRunsByRunner={}; const unread=new Set(); // painel "rodando agora / precisa de você"
    const askingSids=new Set();  // machine+session keys still being analyzed for optional HITL
    // Debate vivo por sessão (interjeição) — declarado JUNTO do resto do estado por sessão, e não perto
    // do card que o desenha, porque `refreshComposer` o consulta e roda antes daquele trecho do arquivo.
    const debateBySession={};
    // ---- config (persisted; refresh não perde estado) ----
    const cfg = Object.assign({ voice:false, continue:false, continueSec:30, silenceSec:1.8, wake:false, noise:true, voiceGate:false, push:false, pushEvents:['done','error'], pushMode:'each', pushEvery:15, lastCwd:'', tab:'rec', treeOpen:false, fileLayout:'side' }, JSON.parse(localStorage.getItem('jarvis')||'{}'));
    // Location is never appended to chat frames. It is collected only after a per-purpose consent
    // and sent through the personal-context protocol with a short expiry.
    const saveCfg = () => localStorage.setItem('jarvis', JSON.stringify(cfg));
    let speak = cfg.voice, speakers = [];
    // ---------- i18n (pt-BR / en / es) — fundação: a chrome sempre-visível é traduzida via data-i18n;
    //            o restante cai no pt (fallback). Novos textos: adicione a chave nos 3 idiomas + data-i18n. ----------
    const I18N={
      pt:{ newSession:'＋ Nova sessão', searchSessions:'buscar entre sessões', whatsUp:'o que está rolando', works:'Trabalhos', fleet:'Uso & custo', openMobile:'abrir no celular', devices:'dispositivos & convites', showMore:'Mostrar mais', settings:'⚙ Configurações', composerPh:'Fale ou digite…', secUpdate:'Atualização', secDefaults:'Padrões', secVoice:'Voz', secNotif:'Notificações', language:'Idioma', spSpeaking:'Jarvis falando…', spListening:'escutando…', spListeningAns:'escutando resposta…', spRefining:'Refinando…', spStopping:'parando…', spThinking:'Jarvis ouvindo…', machineOffline:'offline — as mensagens não serão entregues até ela voltar.', tFillOther:'Preencha o campo "Outros".', tPickOne:'Escolha uma opção ou marque "Outros".', tDelNoResp:'Sem resposta do servidor — a conversa NÃO foi removida.', tOpenFirst:'Abra uma conversa primeiro.', tPassShort:'Senha curta demais (mín. 8).', tPushUnsup:'Notificações não suportadas neste navegador.', tPushDenied:'Permissão de notificação negada.', tPushNoKey:'Servidor sem chave de push.', tMemReindexing:'Reindexando a memória semântica…', tRtFill:'Preencha o nome e o que rodar.', tFolderCopied:'Pasta copiada ✓', tDelFail:'Não consegui remover a conversa (talvez já não exista).', tShareIn:'Conteúdo compartilhado adicionado.', stAsking:'Jarvis perguntando…', stListeningAns:'Escutando resposta…', stSummarizing:'Gerando resumo…', stAnalyzing:'Analisando sessões…', lblAgent:'Agente padrão', lblModel:'Modelo padrão', lblEffort:'Esforço padrão', lblSlash:'Autocomplete de comandos ao digitar "/"', lblSpeakDefault:'Falar as respostas por padrão', lblContinue:'Após responder, continuar escutando follow-up', lblContinueWin:'Janela de escuta de continuação (segundos)', lblSilenceWin:'Pausa antes de encerrar a fala (segundos)', lblVoiceTimbre:'Voz falada (timbre)', lblVoiceEscalate:'Refino por voz — modelo em análises difíceis', secAdvListen:'Escuta avançada', lblWake:'Wake word "Hey Jarvis" (máquina/APK)', lblNoise:'Filtro anti-ruído / detecção de fala (VAD)', lblPushDevice:'Notificar neste aparelho (Web Push)', lblBioLock:'Bloquear com biometria (Face ID / digital)', lblShareGeo:'Compartilhar a localização deste aparelho (para pedidos como “por perto”)', lblNotifyAbout:'Avisar sobre — vale só para este aparelho:', lblPushDone:'Sessão concluída (qualquer máquina)', lblPushError:'Falhas / erros', lblPushMachine:'Máquina ficou offline', lblDelivery:'Entrega', optEach:'Na hora, a cada evento', optGrouped:'Agrupar e avisar de tempos em tempos', lblEveryMin:'A cada quantos minutos', secRoutines:'Rotinas agendadas', secAutoRoute:'Roteamento automático, resumos e status', descAutoRoute:'A IA, o modelo e o esforço abaixo analisam mensagens em modo Automático e também executam resumos e consultas de status. Roda sempre no servidor (Hub).', lblVoiceRelevance:'Só despachar falas que são comando (filtro anti-ruído)', tVoiceIgnored:'🎙️ Ignorei — não pareceu um comando.', tQueued:'📋 Adicionado à fila — roda quando o turno atual terminar.' },
      en:{ newSession:'＋ New session', searchSessions:'search across sessions', whatsUp:"what's going on", works:'Work', fleet:'Usage & cost', openMobile:'open on phone', devices:'devices & invites', showMore:'Show more', settings:'⚙ Settings', composerPh:'Speak or type…', secUpdate:'Update', secDefaults:'Defaults', secVoice:'Voice', secNotif:'Notifications', language:'Language', spSpeaking:'Jarvis speaking…', spListening:'listening…', spListeningAns:'listening for your answer…', spRefining:'Refining…', spStopping:'stopping…', spThinking:'Jarvis listening…', machineOffline:"is offline — messages won't be delivered until it's back.", tFillOther:'Fill in the "Other" field.', tPickOne:'Pick an option or check "Other".', tDelNoResp:'No response from the server — the conversation was NOT deleted.', tOpenFirst:'Open a conversation first.', tPassShort:'Password too short (min. 8).', tPushUnsup:'Notifications not supported in this browser.', tPushDenied:'Notification permission denied.', tPushNoKey:'Server has no push key.', tMemReindexing:'Reindexing semantic memory…', tRtFill:'Fill in the name and what to run.', tFolderCopied:'Folder copied ✓', tDelFail:"Couldn't delete the conversation (it may no longer exist).", tShareIn:'Shared content added.', stAsking:'Jarvis asking…', stListeningAns:'Listening for your answer…', stSummarizing:'Generating summary…', stAnalyzing:'Analyzing sessions…', lblAgent:'Default agent', lblModel:'Default model', lblEffort:'Default effort', lblSlash:'Command autocomplete when typing "/"', lblSpeakDefault:'Speak replies by default', lblContinue:'After replying, keep listening for a follow-up', lblContinueWin:'Follow-up listening window (seconds)', lblSilenceWin:'Pause before ending speech (seconds)', lblVoiceTimbre:'Spoken voice (timbre)', lblVoiceEscalate:'Voice refine — model for hard analysis', secAdvListen:'Advanced listening', lblWake:'Wake word "Hey Jarvis" (on the machine)', lblNoise:'Noise filter / voice activity detection (VAD)', lblPushDevice:'Notify on this device (Web Push)', lblBioLock:'Lock with biometrics (Face ID / fingerprint)', lblShareGeo:'Share this device’s location (for requests like “nearby”)', lblNotifyAbout:'Notify about — this device only:', lblPushDone:'Session done (any machine)', lblPushError:'Failures / errors', lblPushMachine:'A machine went offline', lblDelivery:'Delivery', optEach:'Immediately, each event', optGrouped:'Group and notify periodically', lblEveryMin:'Every how many minutes', secRoutines:'Scheduled routines', lblVoiceRelevance:'Only dispatch utterances that are commands (noise filter)', tVoiceIgnored:"🎙️ Ignored — didn't seem like a command.", tQueued:'📋 Queued — it will run when the current turn finishes.' },
      es:{ newSession:'＋ Nueva sesión', searchSessions:'buscar entre sesiones', whatsUp:'qué está pasando', works:'Trabajos', fleet:'Uso y costo', openMobile:'abrir en el móvil', devices:'dispositivos e invitaciones', showMore:'Mostrar más', settings:'⚙ Configuración', composerPh:'Habla o escribe…', secUpdate:'Actualización', secDefaults:'Predeterminados', secVoice:'Voz', secNotif:'Notificaciones', language:'Idioma', spSpeaking:'Jarvis hablando…', spListening:'escuchando…', spListeningAns:'escuchando tu respuesta…', spRefining:'Refinando…', spStopping:'deteniendo…', spThinking:'Jarvis escuchando…', machineOffline:'desconectada — los mensajes no se entregarán hasta que vuelva.', tFillOther:'Completa el campo "Otros".', tPickOne:'Elige una opción o marca "Otros".', tDelNoResp:'Sin respuesta del servidor — la conversación NO fue eliminada.', tOpenFirst:'Abre una conversación primero.', tPassShort:'Contraseña muy corta (mín. 8).', tPushUnsup:'Notificaciones no soportadas neste navegador.', tPushDenied:'Permiso de notificación denegado.', tPushNoKey:'El servidor no tiene clave push.', tMemReindexing:'Reindexando la memoria semántica…', tRtFill:'Completa el nombre y qué ejecutar.', tFolderCopied:'Carpeta copiada ✓', tDelFail:'No pude eliminar la conversación (quizá ya no exista).', tShareIn:'Contenido compartido añadido.', stAsking:'Jarvis preguntando…', stListeningAns:'Escuchando tu respuesta…', stSummarizing:'Generando resumen…', stAnalyzing:'Analizando sesiones…', lblAgent:'Agente predeterminado', lblModel:'Modelo predeterminado', lblEffort:'Esfuerzo predeterminado', lblSlash:'Autocompletado de comandos al escribir "/"', lblSpeakDefault:'Leer las respuestas por defecto', lblContinue:'Tras responder, seguir escuchando un seguimiento', lblContinueWin:'Ventana de escucha de seguimiento (segundos)', lblSilenceWin:'Pausa antes de terminar el habla (segundos)', lblVoiceTimbre:'Voz hablada (timbre)', lblVoiceEscalate:'Refinamiento por voz — modelo para análisis difíciles', secAdvListen:'Escucha avanzada', lblWake:'Palabra de activación "Hey Jarvis" (en la máquina)', lblNoise:'Filtro de ruido / detección de voz (VAD)', lblPushDevice:'Notificar en este dispositivo (Web Push)', lblBioLock:'Bloquear con biometría (Face ID / huella)', lblShareGeo:'Compartir la ubicación de este dispositivo (para pedidos como “cerca”)', lblNotifyAbout:'Avisar sobre — solo este dispositivo:', lblPushDone:'Sesión terminada (cualquier máquina)', lblPushError:'Fallos / errores', lblPushMachine:'Una máquina se desconectó', lblDelivery:'Entrega', optEach:'Al instante, cada evento', optGrouped:'Agrupar y avisar periódicamente', lblEveryMin:'Cada cuántos minutos', secRoutines:'Rutinas programadas', lblVoiceRelevance:'Solo despachar frases que son comando (filtro de ruido)', tVoiceIgnored:'🎙️ Ignoré — no pareció un comando.', tQueued:'📋 En cola — se ejecutará cuando termine el turno actual.' },
    };
    Object.assign(I18N.en,{secAutoRoute:'Automatic routing, summaries and status',descAutoRoute:'The AI, model and effort below analyze messages in Automatic mode and also run summaries and status checks. It always runs on the Hub.'});
    Object.assign(I18N.es,{secAutoRoute:'Enrutamiento automático, resúmenes y estado',descAutoRoute:'La IA, el modelo y el esfuerzo siguientes analizan mensajes en modo Automático y también ejecutan resúmenes y consultas de estado. Siempre se ejecuta en el Hub.'});
    I18N.es.tPushUnsup='Notificaciones no soportadas en este navegador.';
    I18N.pt.lblSlash='Autocomplete e sugestões ao digitar “/”, “@”, “#” e “!”';
    I18N.en.lblSlash='Autocomplete and suggestions when typing “/”, “@”, “#” and “!”';
    I18N.es.lblSlash='Autocompletado y sugerencias al escribir “/”, “@”, “#” y “!”';
    I18N.pt.secDefaults='Chat'; I18N.en.secDefaults='Chat'; I18N.es.secDefaults='Chat';
    Object.assign(I18N.pt,{swShort:'Soluções',swName:'Espaço de Soluções',swNameAlt:'Solution Workspace',swModeCouncil:'Conselho',swModeBenchmark:'Benchmark',swModeReview:'Revisão',swModeAudit:'Auditoria',swModeDebate:'Debate',swHelpCouncil:'Delibera com várias lentes e publica uma síntese com veredito, dissensos, riscos e próximo passo.',swHelpBenchmark:'Compara soluções concorrentes para a mesma tarefa. Pode escrever em worktrees isoladas e promove a melhor.',swHelpReview:'Roda revisores independentes em paralelo para encontrar achados complementares. Não edita arquivos.',swHelpAudit:'Revisão formal com foco em severidade, evidências, risco e plano de ação. Não edita arquivos.',swHelpDebate:'Discussão iterativa entre 2+ IAs, com réplicas cruzadas, até um juiz declarar consenso ou atingir o teto de rodadas.',swNative:'Espaço de Soluções ainda não grava resultado em sessão nativa.',swTitle:'Espaço de Soluções: Conselho, Benchmark, Revisão paralela, Auditoria e Debate',swStarted:'Rodada iniciada — acompanhe em Trabalhos.'});
    Object.assign(I18N.en,{swShort:'Solutions',swName:'Solution Workspace',swNameAlt:'Espaço de Soluções',swModeCouncil:'Council',swModeBenchmark:'Benchmark',swModeReview:'Review',swModeAudit:'Audit',swModeDebate:'Debate',swHelpCouncil:'Deliberates through multiple lenses and publishes a synthesis with verdict, dissent, risks and next step.',swHelpBenchmark:'Compares competing solutions for the same task. Can write in isolated worktrees and promote the best result.',swHelpReview:'Runs independent reviewers in parallel to find complementary findings. Does not edit files.',swHelpAudit:'Formal review focused on severity, evidence, risk and action plan. Does not edit files.',swHelpDebate:'Iterative discussion between 2+ AIs with cross rebuttals, until a judge declares consensus or the round cap is reached.',swNative:'Solution Workspace cannot write back to native sessions yet.',swTitle:'Solution Workspace: Council, Benchmark, Parallel Review, Audit and Debate',swStarted:'Workspace run started — follow it in Work.'});
    Object.assign(I18N.es,{swShort:'Soluciones',swName:'Espacio de Soluciones',swNameAlt:'Solution Workspace',swModeCouncil:'Consejo',swModeBenchmark:'Benchmark',swModeReview:'Revisión',swModeAudit:'Auditoría',swModeDebate:'Debate',swHelpCouncil:'Delibera con varias lentes y publica una síntesis con veredicto, disensos, riesgos y próximo paso.',swHelpBenchmark:'Compara soluciones competidoras para la misma tarea. Puede escribir en worktrees aisladas y promover el mejor resultado.',swHelpReview:'Ejecuta revisores independientes en paralelo para encontrar hallazgos complementarios. No edita archivos.',swHelpAudit:'Revisión formal enfocada en severidad, evidencias, riesgo y plan de acción. No edita archivos.',swHelpDebate:'Discusión iterativa entre 2+ IAs con réplicas cruzadas, hasta que un juez declare consenso o se alcance el tope de rondas.',swNative:'El Espacio de Soluciones aún no escribe resultados en sesiones nativas.',swTitle:'Espacio de Soluciones: Consejo, Benchmark, Revisión paralela, Auditoría y Debate',swStarted:'Ronda iniciada — síguela en Trabajos.'});
    Object.assign(I18N.pt,{sendTitle:'Enviar mensagem',hSettings:'Abre as configurações do Jarvis.',hGeneral:'Idioma, padrões de agente/modelo e atalhos globais.',hVoicePanel:'Voz, wake word, timbre, identificação e escuta contínua.',hNotifPanel:'Push, biometria, localização e preferências de entrega.',hAutomationPanel:'Rotinas, políticas adaptativas, trabalhos e subagentes.',hFrameworkPanel:'Framework universal, comandos e instruções compartilhadas entre IAs.',hUsagePanel:'Uso, custo, modelos e consumo por sessão/máquina.',hMobilePanel:'Link e QR para abrir esta instância no telefone.',hDevicePanel:'Dispositivos autorizados, convites e credenciais.',hUpdatePanel:'Atualizações do Hub, runners e verificação de versão.',hNewSess:'Cria uma nova conversa com agente, modelo e pasta atuais.',hSearch:'Busca mensagens e sessões por texto ou memória semântica.',hDigest:'Gera um panorama falado do que está acontecendo entre sessões.',hWork:'Mostra trabalhos, subagentes, tarefas em background e estados pendentes.',hUsage:'Mostra consumo, contexto e limites estimados da sessão.',hMobile:'Mostra QR/URL para abrir o Jarvis no telefone.',hDevices:'Gerencia dispositivos, convites e permissões.',hUpdate:'Verifica e aplica atualizações do Hub e runners.',hSummary:'Resume esta conversa e fala o resumo.',hTerminal:'Abre terminais na máquina selecionada.',hFiles:'Abre a árvore de arquivos da pasta da sessão.',hOptions:'Mostra opções extras do composer em telas compactas.',hAttach:'Anexa imagens, textos e arquivos para a próxima mensagem.',hDesign:'Abre o Design Mode para navegar, selecionar elementos e enviar feedback visual.',hSolutions:'Executa Conselho, Benchmark, Revisão paralela ou Auditoria com múltiplas IAs.',hAgent:'Escolhe a IA usada em novas mensagens desta sessão.',hCwd:'Escolhe a pasta de trabalho da sessão.',hModel:'Escolhe o modelo usado nesta sessão quando o agente permite.',hEffort:'Escolhe o nível de esforço/capacidade quando disponível.',hSpeak:'Liga ou desliga leitura falada das respostas.',hStop:'Para a execução atual e libera a fila quando possível.',hSend:'Envia o texto, voz ou anexos atuais.',hLang:'Define o idioma da interface e filtra opções dependentes de idioma.',hDefaultAgent:'IA padrão para novas sessões.',hDefaultModel:'Modelo padrão usado quando a sessão não define outro.',hDefaultEffort:'Esforço padrão usado quando o modelo suporta esse controle.',hSlash:'Ativa sugestões rápidas para comandos, arquivos, memória e shell.',hVoiceAgent:'IA usada para interpretar comandos iniciados por voz.',hVoiceTimbre:'Escolhe a voz falada; opções cloud exigem chave configurada.',hWake:'Escuta “Hey Jarvis” no listener local ou APK Android.',hNoise:'Reduz ruído e detecta fala antes de enviar áudio.',hVoiceGate:'Bloqueia comandos de voz de pessoas não cadastradas.',hPush:'Notifica este aparelho sobre conclusões, falhas e máquinas offline.',hBio:'Protege o app com biometria quando disponível.',hGeo:'Compartilha a localização deste aparelho para pedidos dependentes de lugar.',hRoutine:'Agenda prompts recorrentes por frase simples ou cron.',hRoutineRun:'Executa a rotina agora, sem esperar a agenda.',hPolicy:'Controla autonomia, escrita no repo, aprovações e limites de custo/tokens.',hFramework:'Configura comandos e instruções universais publicados para todas as IAs.'});
    Object.assign(I18N.en,{sendTitle:'Send message',hNewSess:'Creates a new conversation using the current agent, model and folder.',hSearch:'Searches messages and sessions by text or semantic memory.',hDigest:'Generates a spoken overview of what is happening across sessions.',hWork:'Shows work items, subagents, background tasks and pending states.',hUsage:'Shows estimated usage, context and session limits.',hMobile:'Shows the QR/URL to open Jarvis on your phone.',hDevices:'Manages devices, invites and permissions.',hUpdate:'Checks and applies Hub and runner updates.',hSummary:'Summarizes this conversation and speaks the summary.',hTerminal:'Opens terminals on the selected machine.',hFiles:'Opens the file tree for the session folder.',hOptions:'Shows extra composer options on compact screens.',hAttach:'Attaches images, text and files to the next message.',hDesign:'Opens Design Mode to browse, select elements and send visual feedback.',hSolutions:'Runs Council, Benchmark, Parallel Review or Audit with multiple AIs.',hAgent:'Chooses the AI used for new messages in this session.',hCwd:'Chooses the working folder for the session.',hModel:'Chooses the model when the agent supports per-turn selection.',hEffort:'Chooses effort/capability level when available.',hSpeak:'Turns spoken replies on or off.',hStop:'Stops the current execution and frees the queue when possible.',hSend:'Sends the current text, voice or attachments.',hLang:'Sets the interface language and filters language-specific options.',hDefaultAgent:'Default AI for new sessions.',hDefaultModel:'Default model when the session does not override it.',hDefaultEffort:'Default effort when the model supports that control.',hSlash:'Enables quick suggestions for commands, files, memory and shell.',hVoiceAgent:'AI used to interpret voice-started commands.',hVoiceTimbre:'Chooses the spoken voice; cloud options require a configured key.',hWake:'Listens for “Hey Jarvis” through the local listener or Android APK.',hNoise:'Reduces noise and detects speech before sending audio.',hVoiceGate:'Blocks voice commands from unenrolled speakers.',hPush:'Notifies this device about completions, failures and offline machines.',hBio:'Protects the app with biometrics when available.',hGeo:'Shares this device location for location-aware requests.',hRoutine:'Schedules recurring prompts using simple phrases or cron.',hRoutineRun:'Runs the routine now without waiting for the schedule.',hPolicy:'Controls autonomy, repo writes, approvals and cost/token limits.',hFramework:'Configures universal commands and instructions published to every AI.'});
    Object.assign(I18N.es,{sendTitle:'Enviar mensaje',hNewSess:'Crea una nueva conversación con la IA, modelo y carpeta actuales.',hSearch:'Busca mensajes y sesiones por texto o memoria semántica.',hDigest:'Genera un panorama hablado de lo que ocurre entre sesiones.',hWork:'Muestra trabajos, subagentes, tareas en segundo plano y estados pendientes.',hUsage:'Muestra consumo estimado, contexto y límites de la sesión.',hMobile:'Muestra el QR/URL para abrir Jarvis en el teléfono.',hDevices:'Gestiona dispositivos, invitaciones y permisos.',hUpdate:'Verifica y aplica actualizaciones del Hub y runners.',hSummary:'Resume esta conversación y lee el resumen.',hTerminal:'Abre terminales en la máquina seleccionada.',hFiles:'Abre el árbol de archivos de la carpeta de la sesión.',hOptions:'Muestra opciones extra del composer en pantallas compactas.',hAttach:'Adjunta imágenes, textos y archivos al próximo mensaje.',hDesign:'Abre Design Mode para navegar, seleccionar elementos y enviar feedback visual.',hSolutions:'Ejecuta Consejo, Benchmark, Revisión paralela o Auditoría con varias IAs.',hAgent:'Elige la IA usada en nuevos mensajes de esta sesión.',hCwd:'Elige la carpeta de trabajo de la sesión.',hModel:'Elige el modelo cuando la IA permite selección por turno.',hEffort:'Elige el nivel de esfuerzo/capacidad cuando está disponible.',hSpeak:'Activa o desactiva respuestas habladas.',hStop:'Detiene la ejecución actual y libera la cola cuando sea posible.',hSend:'Envía el texto, voz o adjuntos actuales.',hLang:'Define el idioma de la interfaz y filtra opciones por idioma.',hDefaultAgent:'IA predeterminada para nuevas sesiones.',hDefaultModel:'Modelo predeterminado cuando la sesión no define otro.',hDefaultEffort:'Esfuerzo predeterminado cuando el modelo lo soporta.',hSlash:'Activa sugerencias rápidas para comandos, archivos, memoria y shell.',hVoiceAgent:'IA usada para interpretar comandos iniciados por voz.',hVoiceTimbre:'Elige la voz hablada; opciones cloud requieren clave configurada.',hWake:'Escucha “Hey Jarvis” con el listener local o APK Android.',hNoise:'Reduce ruido y detecta habla antes de enviar audio.',hVoiceGate:'Bloquea comandos de voz de hablantes no registrados.',hPush:'Notifica este dispositivo sobre finalizaciones, fallos y máquinas offline.',hBio:'Protege la app con biometría cuando esté disponible.',hGeo:'Comparte la ubicación de este dispositivo para pedidos con ubicación.',hRoutine:'Agenda prompts recurrentes con frases simples o cron.',hRoutineRun:'Ejecuta la rutina ahora sin esperar la agenda.',hPolicy:'Controla autonomía, escritura en repo, aprobaciones y límites de costo/tokens.',hFramework:'Configura comandos e instrucciones universales publicadas para todas las IAs.'});
    Object.assign(I18N.en,{hSettings:'Opens Jarvis settings.',hGeneral:'Language, default agent/model and global shortcuts.',hVoicePanel:'Voice, wake word, timbre, identification and continuous listening.',hNotifPanel:'Push, biometrics, location and delivery preferences.',hAutomationPanel:'Routines, adaptive policies, work items and subagents.',hFrameworkPanel:'Universal framework, commands and instructions shared across AIs.',hUsagePanel:'Usage, cost, models and consumption by session/machine.',hMobilePanel:'Link and QR to open this instance on your phone.',hDevicePanel:'Authorized devices, invites and credentials.',hUpdatePanel:'Hub, runner and version update checks.'});
    Object.assign(I18N.es,{hSettings:'Abre la configuración de Jarvis.',hGeneral:'Idioma, IA/modelo predeterminados y atajos globales.',hVoicePanel:'Voz, wake word, timbre, identificación y escucha continua.',hNotifPanel:'Push, biometría, ubicación y preferencias de entrega.',hAutomationPanel:'Rutinas, políticas adaptativas, trabajos y subagentes.',hFrameworkPanel:'Framework universal, comandos e instrucciones compartidas entre IAs.',hUsagePanel:'Uso, costo, modelos y consumo por sesión/máquina.',hMobilePanel:'Link y QR para abrir esta instancia en el teléfono.',hDevicePanel:'Dispositivos autorizados, invitaciones y credenciales.',hUpdatePanel:'Actualizaciones del Hub, runners y verificación de versión.'});
    Object.assign(I18N.pt,{secHelp:'Ajuda',settingsHelpBtnTitle:'Ajuda desta seção',helpWhat:'O que é',helpOptions:'Opções principais',closeHelp:'Fechar',settingsHelpGeneralTitle:'Configurações gerais',settingsHelpVoiceTitle:'Voz',settingsHelpNotifTitle:'Notificações',settingsHelpAutomationTitle:'Automação',settingsHelpFrameworkTitle:'Framework',settingsHelpRouteTitle:'Roteamento',settingsHelpUsageTitle:'Uso e custo',settingsHelpMobileTitle:'Abrir no celular',settingsHelpDeviceTitle:'Dispositivos e convites',settingsHelpUpdateTitle:'Atualização',hHelpPanel:'Busca explicações curtas sobre recursos que costumam gerar dúvida.',helpSearchPh:'Buscar ajuda',helpEmpty:'Nada encontrado.',helpIntro:'Pesquise dúvidas de configuração, voz, notificações, automações e Soluções.',wakeDetected:'Hey Jarvis detectado. Pode falar.',wakeDetectedToast:'Hey Jarvis detectado. Ouvindo...',wakeMicError:'Não consegui abrir o microfone',helpWakeLockedTitle:'Wake word com telefone bloqueado',hWakeLocked:'Android pode manter um serviço de microfone em primeiro plano. Para uso real com tela bloqueada, a detecção e a captura pós-wake precisam ser nativas; Web/PWA não consegue gravar livremente em background.',helpNotifPlatformsTitle:'Notificações por plataforma',hNotifPlatforms:'Android usa FCM no APK; iOS usa APNs via FCM; Web/PWA usa Web Push; Electron usa notificações do sistema. Cada aparelho tem permissão, bateria e entrega próprias.',helpPushTitle:'Quando a notificação chega',hPushDelivery:'O Jarvis avisa conclusão, falha ou máquina offline conforme as preferências deste aparelho. As mensagens são resumidas para caber nos limites de push.',helpSolutionsTitle:'Espaço de Soluções',hSolutionsUse:'Use Conselho para deliberação, Benchmark para comparar execuções, Revisão para achar problemas complementares e Auditoria para severidade/evidência.',helpRoutineTitle:'Agenda de rotinas',hRoutineUse:'Aceita cron de 5 campos e frases como “a cada 3 horas” ou “cada 2 dias às 08:30”. O resultado mostra o horário real normalizado.',helpStopTitle:'Parar e fila',hStopQueue:'Parar tenta cancelar a execução ativa da sessão e liberar o próximo item da fila. Trabalhos em background aparecem em Trabalhos quando há algo rastreável.',helpVoiceTitle:'Voz e confirmação',hVoiceUse:'Depois do wake ou microfone, o Jarvis deve mostrar/emitir que começou a ouvir, transcrever e então enviar para a sessão correta.'});
    Object.assign(I18N.en,{secHelp:'Help',settingsHelpBtnTitle:'Help for this section',helpWhat:'What it is',helpOptions:'Main options',closeHelp:'Close',settingsHelpGeneralTitle:'General settings',settingsHelpVoiceTitle:'Voice',settingsHelpNotifTitle:'Notifications',settingsHelpAutomationTitle:'Automation',settingsHelpFrameworkTitle:'Framework',settingsHelpRouteTitle:'Routing',settingsHelpUsageTitle:'Usage and cost',settingsHelpMobileTitle:'Open on phone',settingsHelpDeviceTitle:'Devices and invites',settingsHelpUpdateTitle:'Update',hHelpPanel:'Search short explanations for features that commonly raise questions.',helpSearchPh:'Search help',helpEmpty:'No results.',helpIntro:'Search configuration, voice, notifications, automations and Solution Workspace help.',wakeDetected:'Hey Jarvis detected. You can speak.',wakeDetectedToast:'Hey Jarvis detected. Listening...',wakeMicError:'Could not open the microphone',helpWakeLockedTitle:'Wake word with locked phone',hWakeLocked:'Android can keep a foreground microphone service. For true locked-screen use, both wake detection and post-wake capture must be native; Web/PWA cannot freely record in the background.',helpNotifPlatformsTitle:'Notifications by platform',hNotifPlatforms:'Android uses FCM in the APK; iOS uses APNs through FCM; Web/PWA uses Web Push; Electron uses system notifications. Each device has its own permission, battery and delivery behavior.',helpPushTitle:'When notifications arrive',hPushDelivery:'Jarvis notifies completion, failure or offline machines according to this device preferences. Messages are summarized to fit push limits.',helpSolutionsTitle:'Solution Workspace',hSolutionsUse:'Use Council for deliberation, Benchmark to compare executions, Review to find complementary issues and Audit for severity/evidence.',helpRoutineTitle:'Routine schedule',hRoutineUse:'Accepts 5-field cron and phrases like “every 3 hours” or “every 2 days at 08:30”. The result shows the normalized real value.',helpStopTitle:'Stop and queue',hStopQueue:'Stop tries to cancel the active session execution and release the next queued item. Background work appears in Work when there is something traceable.',helpVoiceTitle:'Voice confirmation',hVoiceUse:'After wake or microphone, Jarvis should signal that it started listening, transcribe, then send to the right session.'});
    Object.assign(I18N.es,{secHelp:'Ayuda',settingsHelpBtnTitle:'Ayuda de esta sección',helpWhat:'Qué es',helpOptions:'Opciones principales',closeHelp:'Cerrar',settingsHelpGeneralTitle:'Configuración general',settingsHelpVoiceTitle:'Voz',settingsHelpNotifTitle:'Notificaciones',settingsHelpAutomationTitle:'Automatización',settingsHelpFrameworkTitle:'Framework',settingsHelpRouteTitle:'Ruteo',settingsHelpUsageTitle:'Uso y costo',settingsHelpMobileTitle:'Abrir en el móvil',settingsHelpDeviceTitle:'Dispositivos e invitaciones',settingsHelpUpdateTitle:'Actualización',hHelpPanel:'Busca explicaciones cortas sobre recursos que suelen generar dudas.',helpSearchPh:'Buscar ayuda',helpEmpty:'Sin resultados.',helpIntro:'Busca ayuda de configuración, voz, notificaciones, automatizaciones y Espacio de Soluciones.',wakeDetected:'Hey Jarvis detectado. Puedes hablar.',wakeDetectedToast:'Hey Jarvis detectado. Escuchando...',wakeMicError:'No pude abrir el micrófono',helpWakeLockedTitle:'Wake word con teléfono bloqueado',hWakeLocked:'Android puede mantener un servicio de micrófono en primer plano. Para uso real con pantalla bloqueada, la detección y la captura posterior deben ser nativas; Web/PWA no puede grabar libremente en segundo plano.',helpNotifPlatformsTitle:'Notificaciones por plataforma',hNotifPlatforms:'Android usa FCM en el APK; iOS usa APNs vía FCM; Web/PWA usa Web Push; Electron usa notificaciones del sistema. Cada dispositivo tiene permisos, batería y entrega propios.',helpPushTitle:'Cuándo llega la notificación',hPushDelivery:'Jarvis avisa finalización, fallo o máquina offline según las preferencias de este dispositivo. Los mensajes se resumen para caber en los límites de push.',helpSolutionsTitle:'Espacio de Soluciones',hSolutionsUse:'Usa Consejo para deliberar, Benchmark para comparar ejecuciones, Revisión para hallar problemas complementarios y Auditoría para severidad/evidencia.',helpRoutineTitle:'Agenda de rutinas',hRoutineUse:'Acepta cron de 5 campos y frases como “cada 3 horas” o “cada 2 días a las 08:30”. El resultado muestra el valor real normalizado.',helpStopTitle:'Detener y cola',hStopQueue:'Detener intenta cancelar la ejecución activa de la sesión y liberar el próximo elemento en cola. El trabajo en segundo plano aparece en Trabajos cuando hay algo rastreable.',helpVoiceTitle:'Confirmación de voz',hVoiceUse:'Después del wake o micrófono, Jarvis debe indicar que empezó a escuchar, transcribir y enviar a la sesión correcta.'});
    Object.assign(I18N.pt,{personalAssistant:'Assistente pessoal',personalQueryNote:'Consulta somente fontes autorizadas e mostra a procedência de cada resultado.',personalPurpose:'Finalidade',purposeNearby:'Locais próximos',purposeMobility:'Mobilidade',purposeCalendar:'Agenda',purposeEvents:'Eventos',purposeWeather:'Clima',purposeAutomation:'Casa e automações',personalQuestion:'O que você procura?',personalQueryPh:'Ex.: carregador disponível perto de um restaurante',search:'Buscar',useCurrentLocation:'Usar localização atual',cancel:'Cancelar',approve:'Aprovar',execute:'Executar',personalAssistantDesc:'Cruza apenas dados autorizados para responder, sugerir e executar ações com confirmação proporcional ao risco.',personalEnabled:'Ativar assistente pessoal',personalPaused:'Pausar consultas e sugestões proativas',location:'Localização',locationMode:'Uso da localização',locationOff:'Desativado',locationForeground:'Somente com o app aberto',locationBackground:'Em segundo plano quando a plataforma permitir',locationPrecision:'Precisão compartilhada',approximate:'Aproximada',precise:'Precisa',authorizeLocation:'Autorizar este aparelho',locationPrivacy:'A posição exata permanece temporária no Hub. O histórico usa localização reduzida, salvo se a retenção bruta for ativada explicitamente.',proactiveSuggestions:'Sugestões proativas',quietStart:'Silêncio a partir de',quietEnd:'Silêncio até',maxPerDay:'Máximo por dia',cooldownMinutes:'Intervalo mínimo (minutos)',minRelevance:'Relevância mínima',actionPolicy:'Política de ações',readActions:'Leitura',readActionsPolicy:'Executa automaticamente dentro dos consentimentos.',externalActions:'Ação externa reversível',externalActionsPolicy:'Mostra a prévia e pede confirmação.',consequentialActions:'Ação consequente',consequentialActionsPolicy:'Sempre exige confirmação vinculada à prévia.',saveAssistant:'Salvar assistente',openAssistant:'Abrir assistente',contextSources:'Fontes de contexto',sourcesDesc:'Cada consulta usa somente fontes com consentimento para a finalidade escolhida. Segredos ficam em variáveis do Hub e nunca retornam ao navegador.',loading:'Carregando...',consents:'Consentimentos',configureSource:'Configurar fonte',sourceType:'Tipo',sourceLabel:'Nome',sourceEndpoint:'Endpoint',sourceSecret:'Variável do segredo',allowedResources:'Recursos permitidos',allowedActions:'Ações permitidas',sourceEnabled:'Fonte ativa',saveSource:'Salvar fonte',clear:'Limpar',personalData:'Dados pessoais',favoritePlaces:'Locais favoritos',label:'Nome',address:'Endereço',saveFavorite:'Salvar local',preferences:'Preferências explícitas',preferenceKey:'Categoria',preferenceValue:'Preferência',polarity:'Relação',prefer:'Prefiro',avoid:'Evito',require:'Exijo',purposes:'Finalidades',savePreference:'Salvar preferência',retention:'Retenção e privacidade',observationsDays:'Observações (dias)',decisionsDays:'Decisões (dias)',inferencesDays:'Inferências (dias)',keepRawLocation:'Manter localização bruta no histórico',saveRetention:'Salvar retenção',exportData:'Exportar JSON',pruneData:'Limpar dados expirados',eraseData:'Apagar todos os dados',settingsHelpAssistantTitle:'Assistente pessoal',settingsHelpSourcesTitle:'Fontes de contexto',settingsHelpDataTitle:'Dados pessoais',hAssistantPanel:'Ativa contexto pessoal, localização consentida, sugestões e limites de interrupção.',hSourcesPanel:'Conecta fontes gratuitas ou locais e define consentimentos por finalidade.',hDataPanel:'Gerencia memória explícita, favoritos, retenção, exportação e exclusão.',hPersonal:'Abre consultas contextuais sem enviar localização ou dados pessoais ao chat comum.'});
    Object.assign(I18N.en,{personalAssistant:'Personal assistant',personalQueryNote:'Queries only authorized sources and shows provenance for every result.',personalPurpose:'Purpose',purposeNearby:'Nearby places',purposeMobility:'Mobility',purposeCalendar:'Calendar',purposeEvents:'Events',purposeWeather:'Weather',purposeAutomation:'Home and automations',personalQuestion:'What are you looking for?',personalQueryPh:'Example: available charger near a restaurant',search:'Search',useCurrentLocation:'Use current location',cancel:'Cancel',approve:'Approve',execute:'Execute',personalAssistantDesc:'Combines only authorized data to answer, suggest and execute actions with risk-based confirmation.',personalEnabled:'Enable personal assistant',personalPaused:'Pause queries and proactive suggestions',location:'Location',locationMode:'Location use',locationOff:'Off',locationForeground:'Only while the app is open',locationBackground:'In the background when the platform permits',locationPrecision:'Shared precision',approximate:'Approximate',precise:'Precise',authorizeLocation:'Authorize this device',locationPrivacy:'Exact position stays temporary in the Hub. History uses reduced location unless raw retention is explicitly enabled.',proactiveSuggestions:'Proactive suggestions',quietStart:'Quiet from',quietEnd:'Quiet until',maxPerDay:'Maximum per day',cooldownMinutes:'Minimum interval (minutes)',minRelevance:'Minimum relevance',actionPolicy:'Action policy',readActions:'Read',readActionsPolicy:'Runs automatically within granted consent.',externalActions:'Reversible external action',externalActionsPolicy:'Shows a preview and asks for confirmation.',consequentialActions:'Consequential action',consequentialActionsPolicy:'Always requires confirmation bound to the preview.',saveAssistant:'Save assistant',openAssistant:'Open assistant',contextSources:'Context sources',sourcesDesc:'Each query uses only sources consented for the chosen purpose. Secrets stay in Hub environment variables and never return to the browser.',loading:'Loading...',consents:'Consent',configureSource:'Configure source',sourceType:'Type',sourceLabel:'Name',sourceEndpoint:'Endpoint',sourceSecret:'Secret environment variable',allowedResources:'Allowed resources',allowedActions:'Allowed actions',sourceEnabled:'Source enabled',saveSource:'Save source',clear:'Clear',personalData:'Personal data',favoritePlaces:'Favorite places',label:'Name',address:'Address',saveFavorite:'Save place',preferences:'Explicit preferences',preferenceKey:'Category',preferenceValue:'Preference',polarity:'Relation',prefer:'Prefer',avoid:'Avoid',require:'Require',purposes:'Purposes',savePreference:'Save preference',retention:'Retention and privacy',observationsDays:'Observations (days)',decisionsDays:'Decisions (days)',inferencesDays:'Inferences (days)',keepRawLocation:'Keep raw location in history',saveRetention:'Save retention',exportData:'Export JSON',pruneData:'Remove expired data',eraseData:'Erase all data',settingsHelpAssistantTitle:'Personal assistant',settingsHelpSourcesTitle:'Context sources',settingsHelpDataTitle:'Personal data',hAssistantPanel:'Enables personal context, consented location, suggestions and interruption limits.',hSourcesPanel:'Connects free or local sources and defines consent by purpose.',hDataPanel:'Manages explicit memory, favorites, retention, export and deletion.',hPersonal:'Opens contextual queries without sending location or personal data through ordinary chat.'});
    Object.assign(I18N.es,{personalAssistant:'Asistente personal',personalQueryNote:'Consulta solo fuentes autorizadas y muestra la procedencia de cada resultado.',personalPurpose:'Finalidad',purposeNearby:'Lugares cercanos',purposeMobility:'Movilidad',purposeCalendar:'Agenda',purposeEvents:'Eventos',purposeWeather:'Clima',purposeAutomation:'Casa y automatizaciones',personalQuestion:'¿Qué buscas?',personalQueryPh:'Ej.: cargador disponible cerca de un restaurante',search:'Buscar',useCurrentLocation:'Usar ubicación actual',cancel:'Cancelar',approve:'Aprobar',execute:'Ejecutar',personalAssistantDesc:'Cruza solo datos autorizados para responder, sugerir y ejecutar acciones con confirmación según el riesgo.',personalEnabled:'Activar asistente personal',personalPaused:'Pausar consultas y sugerencias proactivas',location:'Ubicación',locationMode:'Uso de ubicación',locationOff:'Desactivado',locationForeground:'Solo con la app abierta',locationBackground:'En segundo plano cuando la plataforma lo permita',locationPrecision:'Precisión compartida',approximate:'Aproximada',precise:'Precisa',authorizeLocation:'Autorizar este dispositivo',locationPrivacy:'La posición exacta permanece temporal en el Hub. El historial usa ubicación reducida salvo que se active explícitamente la retención bruta.',proactiveSuggestions:'Sugerencias proactivas',quietStart:'Silencio desde',quietEnd:'Silencio hasta',maxPerDay:'Máximo por día',cooldownMinutes:'Intervalo mínimo (minutos)',minRelevance:'Relevancia mínima',actionPolicy:'Política de acciones',readActions:'Lectura',readActionsPolicy:'Se ejecuta automáticamente dentro del consentimiento.',externalActions:'Acción externa reversible',externalActionsPolicy:'Muestra una vista previa y pide confirmación.',consequentialActions:'Acción consecuente',consequentialActionsPolicy:'Siempre exige confirmación vinculada a la vista previa.',saveAssistant:'Guardar asistente',openAssistant:'Abrir asistente',contextSources:'Fuentes de contexto',sourcesDesc:'Cada consulta usa solo fuentes autorizadas para la finalidad elegida. Los secretos permanecen en variables del Hub y nunca vuelven al navegador.',loading:'Cargando...',consents:'Consentimientos',configureSource:'Configurar fuente',sourceType:'Tipo',sourceLabel:'Nombre',sourceEndpoint:'Endpoint',sourceSecret:'Variable del secreto',allowedResources:'Recursos permitidos',allowedActions:'Acciones permitidas',sourceEnabled:'Fuente activa',saveSource:'Guardar fuente',clear:'Limpiar',personalData:'Datos personales',favoritePlaces:'Lugares favoritos',label:'Nombre',address:'Dirección',saveFavorite:'Guardar lugar',preferences:'Preferencias explícitas',preferenceKey:'Categoría',preferenceValue:'Preferencia',polarity:'Relación',prefer:'Prefiero',avoid:'Evito',require:'Exijo',purposes:'Finalidades',savePreference:'Guardar preferencia',retention:'Retención y privacidad',observationsDays:'Observaciones (días)',decisionsDays:'Decisiones (días)',inferencesDays:'Inferencias (días)',keepRawLocation:'Mantener ubicación bruta en el historial',saveRetention:'Guardar retención',exportData:'Exportar JSON',pruneData:'Limpiar datos expirados',eraseData:'Borrar todos los datos',settingsHelpAssistantTitle:'Asistente personal',settingsHelpSourcesTitle:'Fuentes de contexto',settingsHelpDataTitle:'Datos personales',hAssistantPanel:'Activa contexto personal, ubicación consentida, sugerencias y límites de interrupción.',hSourcesPanel:'Conecta fuentes gratuitas o locales y define consentimientos por finalidad.',hDataPanel:'Gestiona memoria explícita, favoritos, retención, exportación y borrado.',hPersonal:'Abre consultas contextuales sin enviar ubicación ni datos personales por el chat común.'});
    Object.assign(I18N.pt,{advancedSource:'Opções avançadas da fonte',sourceCertification:'Certificação MCP',uncertified:'Não certificada',firstParty:'Primeira parte',audited:'Auditada',sourceFormat:'Formato do feed',calendarAccess:'Acesso à agenda',timeZone:'Fuso horário',attribution:'Atribuição',sourcePurposes:'Finalidades desta fonte',commandArgs:'Argumentos do comando',workingDirectory:'Pasta de execução',allowedAttributes:'Atributos permitidos',serviceFields:'Campos de serviço permitidos',allowRemoteHttps:'Permitir HTTPS remoto para este host',testSource:'Testar',edit:'Editar',remove:'Remover',like:'Gostei',avoidSuggestion:'Não sugerir',remember:'Lembrar',sourceTestOk:'Fonte respondeu',hNotifPanel:'Push, biometria e preferências de entrega por aparelho.'});
    Object.assign(I18N.en,{advancedSource:'Advanced source options',sourceCertification:'MCP certification',uncertified:'Uncertified',firstParty:'First-party',audited:'Audited',sourceFormat:'Feed format',calendarAccess:'Calendar access',timeZone:'Time zone',attribution:'Attribution',sourcePurposes:'Source purposes',commandArgs:'Command arguments',workingDirectory:'Working directory',allowedAttributes:'Allowed attributes',serviceFields:'Allowed service fields',allowRemoteHttps:'Allow remote HTTPS for this host',testSource:'Test',edit:'Edit',remove:'Remove',like:'Like',avoidSuggestion:'Do not suggest',remember:'Remember',sourceTestOk:'Source responded',hNotifPanel:'Push, biometrics and per-device delivery preferences.'});
    Object.assign(I18N.es,{advancedSource:'Opciones avanzadas de la fuente',sourceCertification:'Certificación MCP',uncertified:'No certificada',firstParty:'Primera parte',audited:'Auditada',sourceFormat:'Formato del feed',calendarAccess:'Acceso al calendario',timeZone:'Zona horaria',attribution:'Atribución',sourcePurposes:'Finalidades de la fuente',commandArgs:'Argumentos del comando',workingDirectory:'Carpeta de ejecución',allowedAttributes:'Atributos permitidos',serviceFields:'Campos de servicio permitidos',allowRemoteHttps:'Permitir HTTPS remoto para este host',testSource:'Probar',edit:'Editar',remove:'Eliminar',like:'Me gusta',avoidSuggestion:'No sugerir',remember:'Recordar',sourceTestOk:'La fuente respondió',hNotifPanel:'Push, biometría y preferencias de entrega por dispositivo.'});
    Object.assign(I18N.pt,{helpHowLabel:'Como funciona',helpUseLabel:'Como usar',helpDataLabel:'O que acontece com esse dado',helpExampleLabel:'Exemplo',helpMoreLabel:'Ajuda detalhada',helpSheetClose:'Fechar',regionSourceEnable:'Ativar',regionSourceEnabling:'Ativando…',regionSourceEnabled:'Ativada ✓'});
    Object.assign(I18N.en,{helpHowLabel:'How it works',helpUseLabel:'How to use it',helpDataLabel:'What happens to this data',helpExampleLabel:'Example',helpMoreLabel:'Detailed help',helpSheetClose:'Close',regionSourceEnable:'Enable',regionSourceEnabling:'Enabling…',regionSourceEnabled:'Enabled ✓'});
    Object.assign(I18N.es,{helpHowLabel:'Cómo funciona',helpUseLabel:'Cómo usar',helpDataLabel:'Qué ocurre con este dato',helpExampleLabel:'Ejemplo',helpMoreLabel:'Ayuda detallada',helpSheetClose:'Cerrar',regionSourceEnable:'Activar',regionSourceEnabling:'Activando…',regionSourceEnabled:'Activada ✓'});
    // Ajuda detalhada por subseção: cada campo responde O que é / Como usar / O que acontece com o dado.
    const PERSONAL_HELP={
      pt:{
        assistant:{title:'Assistente pessoal',how:'Você pergunta em linguagem natural e o Jarvis cruza apenas os dados que você autorizou — localização, agenda, preferências e fontes — para responder, sugerir e, quando você confirmar, executar ações. Nada disso passa pelo chat comum.',fields:[
          {name:'Ativar assistente pessoal',what:'Liga o mecanismo de contexto pessoal para o seu usuário.',use:'Ative para abrir consultas, receber sugestões e usar localização e agenda. Desligado, nada é coletado nem consultado.',data:'Por si só não coleta nada; apenas habilita os recursos. Cada fonte e a localização ainda exigem consentimento próprio.',example:'Com ele ligado você pode perguntar: “tem carregador livre perto de um restaurante que eu curto?” e o Jarvis cruza localização, preferências e fontes para responder.'},
          {name:'Pausar consultas e sugestões proativas',what:'Pausa temporária que mantém toda a sua configuração.',use:'Use para silenciar o assistente por um tempo sem apagar fontes, favoritos ou preferências.',data:'Interrompe consultas e sugestões; os dados já salvos permanecem e voltam a ser usados quando você despausar.'},
        ]},
        location:{title:'Localização',how:'Controla se e como a sua posição entra nas respostas. A posição exata fica temporária no Hub; o histórico guarda apenas uma versão reduzida, salvo se você ativar retenção bruta em Dados.',fields:[
          {name:'Uso da localização',what:'Define quando o aparelho compartilha posição: desativado, só com o app aberto, ou em segundo plano quando a plataforma permitir.',use:'Escolha somente com o app aberto para o uso comum; segundo plano só se quiser alertas de chegada/saída e o aparelho suportar.',data:'Apenas o modo escolhido é aplicado. Segundo plano exige app nativo e opt-in; com a fonte desativada nada é capturado.'},
          {name:'Precisão compartilhada',what:'Aproximada usa uma área ao redor de você; precisa usa a coordenada exata.',use:'Prefira aproximada no dia a dia; use precisa só quando precisar de resultado no ponto exato, como um carregador na esquina.',data:'Aproximada reduz a posição antes do uso. A exata fica temporária no Hub e não entra no histórico salvo sem retenção bruta.'},
          {name:'Autorizar este aparelho',what:'Concede a permissão de localização do sistema operacional para este aparelho.',use:'Toque para o sistema pedir a permissão; sem ela, consultas que dependem de posição ficam sem localização.',data:'A permissão fica no aparelho. A posição capturada segue o modo e a precisão definidos acima.'},
        ]},
        proactive:{title:'Sugestões proativas',how:'O Jarvis pode te avisar sem você pedir — por exemplo um evento perto de casa ou um clima que afeta seu trajeto — sempre dentro dos limites deste aparelho.',fields:[
          {name:'Receber sugestões proativas neste aparelho',what:'Liga ou desliga as notificações proativas apenas neste aparelho.',use:'Ative no aparelho onde quer receber os avisos; cada aparelho decide o seu.',data:'Controla só a entrega local; não muda o que é coletado. As sugestões saem do que já está autorizado.'},
          {name:'Silêncio a partir de / até',what:'Janela de silêncio em que nenhuma sugestão é enviada.',use:'Defina, por exemplo, 22:00 às 07:00 para não ser incomodado à noite.',data:'Afeta apenas a entrega; nada é coletado ou apagado por isso.'},
          {name:'Máximo por dia',what:'Teto de sugestões proativas por dia.',use:'Reduza se estiver recebendo demais; zero desliga na prática as proativas.',data:'Apenas limite de entrega.'},
          {name:'Intervalo mínimo (minutos)',what:'Tempo mínimo entre duas sugestões seguidas.',use:'Aumente para espaçar mais os avisos.',data:'Apenas limite de entrega.'},
          {name:'Relevância mínima',what:'Nota de 0 a 1 que a sugestão precisa alcançar para valer a interrupção.',use:'Suba para receber só o mais relevante; desça para receber mais coisas.',data:'É um filtro de qualidade; não coleta nada.'},
        ]},
        actionPolicy:{title:'Política de ações',how:'Define quanto o assistente pode fazer sozinho. A exigência de confirmação é proporcional ao risco da ação.',fields:[
          {name:'Leitura',what:'Ações que apenas leem dados, como buscar lugares ou ver a agenda.',use:'Rodam automaticamente dentro do que você consentiu; você não confirma cada consulta.',data:'Não alteram nada externo; só leem as fontes autorizadas.'},
          {name:'Ação externa reversível',what:'Ações que mudam algo mas dá para desfazer, como criar um evento.',use:'O Jarvis mostra uma prévia e espera a sua confirmação antes de executar.',data:'Nada é executado sem a sua confirmação vinculada àquela prévia.'},
          {name:'Ação consequente',what:'Ações de maior impacto ou difíceis de reverter.',use:'Sempre exigem confirmação explícita amarrada à prévia exata.',data:'A execução só ocorre após a confirmação; a prévia registra exatamente o que será feito.'},
        ]},
      },
      en:{
        assistant:{title:'Personal assistant',how:'You ask in natural language and Jarvis crosses only the data you authorized — location, calendar, preferences and sources — to answer, suggest and, once you confirm, run actions. None of it goes through ordinary chat.',fields:[
          {name:'Enable personal assistant',what:'Turns on the personal context engine for your user.',use:'Enable it to open queries, receive suggestions and use location and calendar. Off, nothing is collected or queried.',data:'By itself it collects nothing; it only enables the features. Each source and location still require their own consent.',example:'With it on you can ask: "is there a free charger near a restaurant I like?" and Jarvis crosses location, preferences and sources to answer.'},
          {name:'Pause queries and proactive suggestions',what:'Temporary pause that keeps all of your configuration.',use:'Use it to silence the assistant for a while without deleting sources, favorites or preferences.',data:'Stops queries and suggestions; data already saved stays and is used again when you unpause.'},
        ]},
        location:{title:'Location',how:'Controls whether and how your position enters answers. Exact position stays temporary in the Hub; history keeps only a reduced version unless you enable raw retention in Data.',fields:[
          {name:'Location use',what:'Sets when the device shares position: off, only while the app is open, or in the background when the platform allows.',use:'Choose only while open for everyday use; background only if you want arrival/departure alerts and the device supports it.',data:'Only the chosen mode applies. Background requires a native app and opt-in; with the source off nothing is captured.'},
          {name:'Shared precision',what:'Approximate uses an area around you; precise uses the exact coordinate.',use:'Prefer approximate day to day; use precise only when you need a result at the exact spot, like a charger on the corner.',data:'Approximate reduces the position before use. Precise stays temporary in the Hub and does not enter saved history without raw retention.'},
          {name:'Authorize this device',what:'Grants the operating system location permission for this device.',use:'Tap so the system asks for permission; without it, queries that depend on position have no location.',data:'The permission stays on the device. Captured position follows the mode and precision set above.'},
        ]},
        proactive:{title:'Proactive suggestions',how:'Jarvis can alert you without being asked — an event near home or weather affecting your commute — always within this device limits.',fields:[
          {name:'Receive proactive suggestions on this device',what:'Turns proactive notifications on or off for this device only.',use:'Enable it on the device where you want alerts; each device decides its own.',data:'Controls local delivery only; it does not change what is collected. Suggestions come from what is already authorized.'},
          {name:'Quiet from / until',what:'Quiet-hours window when no suggestion is sent.',use:'Set, for example, 22:00 to 07:00 to avoid being disturbed at night.',data:'Affects delivery only; nothing is collected or deleted because of it.'},
          {name:'Maximum per day',what:'Cap on proactive suggestions per day.',use:'Lower it if you are getting too many; zero effectively turns proactive off.',data:'Delivery limit only.'},
          {name:'Minimum interval (minutes)',what:'Minimum time between two consecutive suggestions.',use:'Increase it to space alerts further apart.',data:'Delivery limit only.'},
          {name:'Minimum relevance',what:'A 0 to 1 score a suggestion must reach to be worth the interruption.',use:'Raise it to get only the most relevant; lower it to get more.',data:'It is a quality filter; it collects nothing.'},
        ]},
        actionPolicy:{title:'Action policy',how:'Sets how much the assistant may do on its own. The confirmation required is proportional to the action risk.',fields:[
          {name:'Read',what:'Actions that only read data, like finding places or checking the calendar.',use:'They run automatically within what you consented; you do not confirm each query.',data:'They change nothing external; they only read authorized sources.'},
          {name:'Reversible external action',what:'Actions that change something but can be undone, like creating an event.',use:'Jarvis shows a preview and waits for your confirmation before running.',data:'Nothing runs without your confirmation bound to that preview.'},
          {name:'Consequential action',what:'Higher-impact actions or ones hard to reverse.',use:'They always require explicit confirmation bound to the exact preview.',data:'Execution only happens after confirmation; the preview records exactly what will be done.'},
        ]},
      },
      es:{
        assistant:{title:'Asistente personal',how:'Preguntas en lenguaje natural y Jarvis cruza solo los datos que autorizaste — ubicación, agenda, preferencias y fuentes — para responder, sugerir y, cuando confirmes, ejecutar acciones. Nada de eso pasa por el chat común.',fields:[
          {name:'Activar asistente personal',what:'Enciende el motor de contexto personal para tu usuario.',use:'Actívalo para abrir consultas, recibir sugerencias y usar ubicación y agenda. Apagado, no se recopila ni consulta nada.',data:'Por sí solo no recopila nada; solo habilita las funciones. Cada fuente y la ubicación aún requieren su propio consentimiento.',example:'Con él activado puedes preguntar: "¿hay un cargador libre cerca de un restaurante que me gusta?" y Jarvis cruza ubicación, preferencias y fuentes para responder.'},
          {name:'Pausar consultas y sugerencias proactivas',what:'Pausa temporal que conserva toda tu configuración.',use:'Úsala para silenciar el asistente un rato sin borrar fuentes, favoritos o preferencias.',data:'Detiene consultas y sugerencias; los datos ya guardados permanecen y se usan de nuevo al reanudar.'},
        ]},
        location:{title:'Ubicación',how:'Controla si y cómo tu posición entra en las respuestas. La posición exacta queda temporal en el Hub; el historial guarda solo una versión reducida salvo que actives retención bruta en Datos.',fields:[
          {name:'Uso de ubicación',what:'Define cuándo el dispositivo comparte posición: desactivado, solo con la app abierta, o en segundo plano cuando la plataforma lo permita.',use:'Elige solo con la app abierta para el uso común; segundo plano solo si quieres alertas de llegada/salida y el dispositivo lo admite.',data:'Solo se aplica el modo elegido. Segundo plano exige app nativa y opt-in; con la fuente desactivada no se captura nada.'},
          {name:'Precisión compartida',what:'Aproximada usa un área a tu alrededor; precisa usa la coordenada exacta.',use:'Prefiere aproximada en el día a día; usa precisa solo cuando necesites un resultado en el punto exacto, como un cargador en la esquina.',data:'Aproximada reduce la posición antes de usarla. La exacta queda temporal en el Hub y no entra en el historial guardado sin retención bruta.'},
          {name:'Autorizar este dispositivo',what:'Concede el permiso de ubicación del sistema operativo para este dispositivo.',use:'Toca para que el sistema pida el permiso; sin él, las consultas que dependen de la posición quedan sin ubicación.',data:'El permiso queda en el dispositivo. La posición capturada sigue el modo y la precisión definidos arriba.'},
        ]},
        proactive:{title:'Sugerencias proactivas',how:'Jarvis puede avisarte sin que lo pidas — un evento cerca de casa o un clima que afecta tu trayecto — siempre dentro de los límites de este dispositivo.',fields:[
          {name:'Recibir sugerencias proactivas en este dispositivo',what:'Enciende o apaga las notificaciones proactivas solo en este dispositivo.',use:'Actívalo en el dispositivo donde quieras los avisos; cada uno decide el suyo.',data:'Controla solo la entrega local; no cambia lo que se recopila. Las sugerencias salen de lo ya autorizado.'},
          {name:'Silencio desde / hasta',what:'Ventana de silencio en la que no se envía ninguna sugerencia.',use:'Define, por ejemplo, 22:00 a 07:00 para no ser molestado de noche.',data:'Afecta solo la entrega; nada se recopila ni se borra por esto.'},
          {name:'Máximo por día',what:'Tope de sugerencias proactivas por día.',use:'Bájalo si recibes demasiadas; cero apaga en la práctica las proactivas.',data:'Solo límite de entrega.'},
          {name:'Intervalo mínimo (minutos)',what:'Tiempo mínimo entre dos sugerencias seguidas.',use:'Auméntalo para espaciar más los avisos.',data:'Solo límite de entrega.'},
          {name:'Relevancia mínima',what:'Nota de 0 a 1 que la sugerencia debe alcanzar para valer la interrupción.',use:'Súbela para recibir solo lo más relevante; bájala para recibir más.',data:'Es un filtro de calidad; no recopila nada.'},
        ]},
        actionPolicy:{title:'Política de acciones',how:'Define cuánto puede hacer el asistente por su cuenta. La confirmación exigida es proporcional al riesgo de la acción.',fields:[
          {name:'Lectura',what:'Acciones que solo leen datos, como buscar lugares o ver la agenda.',use:'Se ejecutan automáticamente dentro de lo que consentiste; no confirmas cada consulta.',data:'No cambian nada externo; solo leen las fuentes autorizadas.'},
          {name:'Acción externa reversible',what:'Acciones que cambian algo pero se pueden deshacer, como crear un evento.',use:'Jarvis muestra una vista previa y espera tu confirmación antes de ejecutar.',data:'Nada se ejecuta sin tu confirmación vinculada a esa vista previa.'},
          {name:'Acción consecuente',what:'Acciones de mayor impacto o difíciles de revertir.',use:'Siempre exigen confirmación explícita vinculada a la vista previa exacta.',data:'La ejecución solo ocurre tras la confirmación; la vista previa registra exactamente lo que se hará.'},
        ]},
      },
    };
    Object.assign(PERSONAL_HELP.pt,{
      sources:{title:'Fontes de contexto',how:'Fontes são de onde o Jarvis tira contexto: mapas, agenda, eventos, clima, casa. Cada consulta usa só as fontes que você consentiu para aquela finalidade e mostra a procedência do resultado.',fields:[
        {name:'Fonte de contexto',what:'Um provedor de dados, como Nominatim para endereços, CalDAV para agenda ou Open-Meteo para clima.',use:'Ative as que quiser usar; o Jarvis escolhe entre elas conforme a finalidade da sua pergunta.',data:'A fonte só é consultada quando está ativa e consentida, e o resultado vem com a procedência de quem respondeu.'},
        {name:'Fonte ativa',what:'Liga ou desliga uma fonte específica.',use:'Desative para tirar uma fonte das consultas sem apagar a configuração dela.',data:'Desativada, ela não é consultada nem contribui para respostas.'},
        {name:'Testar, editar e remover',what:'Ações sobre cada fonte da lista.',use:'Testar checa se ela responde, Editar ajusta os campos e Remover apaga de vez.',data:'Testar faz uma chamada real e descartável; Remover apaga a configuração e os consentimentos ligados a ela.'},
      ]},
      consents:{title:'Consentimentos',how:'Consentimento liga uma fonte a uma finalidade — mobilidade, agenda, eventos, clima, casa. Sem consentimento para a finalidade da pergunta, a fonte não entra.',fields:[
        {name:'Consentimento por finalidade',what:'A autorização de usar uma fonte para um propósito específico.',use:'Conceda só as finalidades que fazem sentido e revogue quando quiser.',data:'Guardado por usuário no Hub. Revogar impede novos usos na hora; o histórico segue a retenção definida em Dados.'},
      ]},
      configureSource:{title:'Configurar fonte',how:'Aqui o owner cadastra uma fonte nova. Segredos ficam em variáveis do Hub e nunca voltam ao navegador.',fields:[
        {name:'Tipo',what:'Qual provedor a fonte usa: CalDAV, Home Assistant, MCP, Open Charge Map, entre outros.',use:'Escolha o tipo; os campos abaixo se ajustam ao que ele precisa.',data:'Define o adaptador e as regras de rede e limite aplicadas à fonte.'},
        {name:'Nome',what:'Um rótulo amigável para identificar a fonte na lista.',use:'Dê um nome claro, como “Agenda do trabalho”.',data:'É só um rótulo; não afeta a consulta.'},
        {name:'Endpoint',what:'A URL do serviço que será consultado.',use:'Cole a URL do provedor, por exemplo o servidor CalDAV.',data:'É validada contra as regras de rede (sem alvos internos por padrão) e fica salva na configuração da fonte.'},
        {name:'Variável do segredo',what:'O nome da variável de ambiente do Hub que guarda o token ou senha.',use:'Informe o nome da variável, como JARVIS_CALDAV_TOKEN — nunca o valor em si.',data:'O valor fica só no Hub; nunca é enviado ao navegador nem aparece nas respostas.'},
        {name:'Recursos e ações permitidos',what:'Limitam quais recursos e ações a fonte pode expor.',use:'Liste só o necessário, como “agenda” e “read”.',data:'Funciona como teto: nada fora dessa lista é lido ou executado.'},
        {name:'Opções avançadas',what:'Certificação MCP, formato do feed, acesso à agenda, fuso, atributos e ambiente do processo stdio.',use:'Ajuste quando o provedor exigir; o padrão já é o mais restrito, como agenda só ocupado/livre.',data:'Detalhes de agenda e HTTPS remoto exigem uma autorização explícita adicional.'},
      ]},
      personalData:{title:'Dados pessoais',how:'O resumo do que o Jarvis guarda sobre você e por quanto tempo. Tudo é por usuário, e você pode exportar ou apagar quando quiser.',fields:[
        {name:'Resumo dos dados',what:'A contagem do que está salvo por categoria: favoritos, preferências, observações e mais.',use:'Confira aqui o que existe antes de exportar ou apagar.',data:'É só leitura do que já está no Hub; nada é enviado para fora.'},
        {name:'Categorias',what:'O agrupamento dos dados por tipo.',use:'Use para apagar uma categoria específica mais abaixo, sem tocar no resto.',data:'Cada categoria segue a própria janela de retenção definida em Retenção.'},
      ]},
      favorites:{title:'Locais favoritos',how:'Lugares que você nomeia, como casa e trabalho, para o Jarvis entender referências e calcular o que é perto ou a rota.',fields:[
        {name:'Nome e endereço',what:'Um apelido e a localização do lugar.',use:'Ex.: “Casa” mais o endereço; use Buscar endereço ou Usar localização atual.',data:'Guardado por usuário no Hub e usado só nas finalidades marcadas. Você pode apagar quando quiser.'},
        {name:'Aliases',what:'Outros nomes que você usa para o mesmo lugar.',use:'Ex.: “lar”, “minha casa” — ajuda o Jarvis a entender você.',data:'Ficam junto do favorito e seguem a mesma retenção.'},
        {name:'Finalidades',what:'Para quais propósitos esse lugar pode ser usado.',use:'Marque, por exemplo, mobilidade e clima.',data:'Restringe onde o favorito entra; fora dessas finalidades ele é ignorado.'},
        {name:'Monitorar chegada e saída',what:'Um geofence opcional que percebe quando você chega ou sai do lugar.',use:'Ative só se quiser sugestões por chegada/saída; exige localização em background e app nativo.',data:'Depende de opt-in de background e não executa ações externas sozinho. Sem suporte nativo, fica inativo.'},
      ]},
      vehicles:{title:'Veículos elétricos',how:'Perfis do seu carro elétrico para filtrar carregadores compatíveis e com potência adequada.',fields:[
        {name:'Conectores e potência',what:'Os tipos de conector (OCM) e as potências que o carro aceita e prefere.',use:'Preencha conforme o manual do carro; o Jarvis filtra os carregadores por isso.',data:'Guardado por usuário e usado só para filtrar resultados. Não confirma disponibilidade ao vivo.'},
        {name:'Veículo padrão',what:'Qual perfil usar quando você não especificar.',use:'Marque o carro do dia a dia.',data:'É só uma preferência de seleção.'},
      ]},
      preferences:{title:'Preferências explícitas',how:'Coisas que você declara gostar, evitar ou exigir. Elas entram no ranking das respostas.',fields:[
        {name:'Categoria e preferência',what:'O tema, como restaurante.cozinha, e o valor, como comida mineira.',use:'Declare o que importa; o Jarvis prioriza ou evita conforme a relação.',data:'Guardado por usuário e usado no ranking. Você pode editar ou apagar quando quiser.'},
        {name:'Relação: prefiro, evito ou exijo',what:'Como a preferência pesa: puxa a favor, contra, ou é obrigatória.',use:'Use exijo só quando for um filtro rígido, como sem escada.',data:'Afeta apenas a ordenação e a filtragem dos resultados.'},
        {name:'Finalidades e válida até',what:'Onde a preferência vale e uma validade opcional.',use:'Limite às finalidades certas e defina validade para algo temporário.',data:'Depois da validade ela para de ser usada; a limpeza segue a retenção.'},
      ]},
      retention:{title:'Retenção e privacidade',how:'Controla por quanto tempo cada tipo de dado é mantido e reúne as ferramentas de exportar e apagar. É o centro da sua privacidade.',fields:[
        {name:'Observações, decisões e inferências (dias)',what:'A janela de retenção de cada tipo de registro.',use:'Reduza para guardar por menos tempo; a limpeza aplica na próxima poda.',data:'Passado o prazo, os registros ficam elegíveis para exclusão automática.'},
        {name:'Manter localização bruta no histórico',what:'Se a posição exata entra no histórico ou só a versão reduzida.',use:'Deixe desligado para mais privacidade; ligue só se precisar de histórico preciso.',data:'Desligado, o histórico guarda localização reduzida e a posição exata fica temporária no Hub.'},
        {name:'Exportar, limpar e apagar',what:'Baixar tudo em JSON, remover expirados, ou apagar tudo.',use:'Exporte para levar seus dados; Apagar remove tudo de forma irreversível.',data:'Exportar não altera nada; Apagar é definitivo e imediato.'},
        {name:'Apagar uma categoria',what:'Remover só um tipo de dado, como apenas preferências.',use:'Use para uma limpeza pontual sem perder o resto.',data:'É irreversível para a categoria escolhida. A configuração de fontes só o owner apaga.'},
      ]},
    });
    Object.assign(PERSONAL_HELP.en,{
      sources:{title:'Context sources',how:'Sources are where Jarvis pulls context from: maps, calendar, events, weather, home. Each query uses only the sources you consented for that purpose and shows the provenance of the result.',fields:[
        {name:'Context source',what:'A data provider, such as Nominatim for addresses, CalDAV for calendar or Open-Meteo for weather.',use:'Enable the ones you want; Jarvis picks among them based on your question purpose.',data:'A source is queried only when enabled and consented, and the result carries the provenance of who answered.'},
        {name:'Source enabled',what:'Turns a specific source on or off.',use:'Disable it to drop a source from queries without deleting its configuration.',data:'When disabled it is not queried and does not contribute to answers.'},
        {name:'Test, edit and remove',what:'Actions on each source in the list.',use:'Test checks that it responds, Edit adjusts fields and Remove deletes it for good.',data:'Test makes a real, throwaway call; Remove deletes the configuration and the consents tied to it.'},
      ]},
      consents:{title:'Consent',how:'Consent links a source to a purpose — mobility, calendar, events, weather, home. Without consent for the question purpose, the source does not take part.',fields:[
        {name:'Consent by purpose',what:'Authorization to use a source for a specific purpose.',use:'Grant only the purposes that make sense and revoke whenever you want.',data:'Stored per user in the Hub. Revoking blocks new uses immediately; history follows the retention set in Data.'},
      ]},
      configureSource:{title:'Configure source',how:'Here the owner registers a new source. Secrets stay in Hub environment variables and never return to the browser.',fields:[
        {name:'Type',what:'Which provider the source uses: CalDAV, Home Assistant, MCP, Open Charge Map and others.',use:'Choose the type; the fields below adapt to what it needs.',data:'Defines the adapter and the network and rate rules applied to the source.'},
        {name:'Name',what:'A friendly label to identify the source in the list.',use:'Give it a clear name, like "Work calendar".',data:'Just a label; it does not affect the query.'},
        {name:'Endpoint',what:'The URL of the service to query.',use:'Paste the provider URL, for example the CalDAV server.',data:'It is validated against network rules (no internal targets by default) and stored in the source configuration.'},
        {name:'Secret variable',what:'The name of the Hub environment variable that holds the token or password.',use:'Enter the variable name, like JARVIS_CALDAV_TOKEN — never the value itself.',data:'The value stays only in the Hub; it is never sent to the browser or shown in answers.'},
        {name:'Allowed resources and actions',what:'Limit which resources and actions the source may expose.',use:'List only what is needed, such as "calendar" and "read".',data:'Acts as a ceiling: nothing outside that list is read or run.'},
        {name:'Advanced options',what:'MCP certification, feed format, calendar access, time zone, attributes and the stdio process environment.',use:'Adjust when the provider requires it; the default is already the most restrictive, like calendar busy/free only.',data:'Calendar details and remote HTTPS require an extra explicit authorization.'},
      ]},
      personalData:{title:'Personal data',how:'A summary of what Jarvis keeps about you and for how long. Everything is per user, and you can export or erase it whenever you want.',fields:[
        {name:'Data summary',what:'The count of what is saved per category: favorites, preferences, observations and more.',use:'Check here what exists before exporting or erasing.',data:'It only reads what is already in the Hub; nothing is sent out.'},
        {name:'Categories',what:'Grouping of data by type.',use:'Use it to erase a specific category below without touching the rest.',data:'Each category follows its own retention window set in Retention.'},
      ]},
      favorites:{title:'Favorite places',how:'Places you name, like home and work, so Jarvis understands references and computes what is nearby or the route.',fields:[
        {name:'Name and address',what:'A nickname and the location of the place.',use:'For example "Home" plus the address; use Find address or Use current location.',data:'Stored per user in the Hub and used only for the marked purposes. You can erase it anytime.'},
        {name:'Aliases',what:'Other names you use for the same place.',use:'For example "home", "my place" — it helps Jarvis understand you.',data:'They stay with the favorite and follow the same retention.'},
        {name:'Purposes',what:'For which purposes the place may be used.',use:'Mark, for example, mobility and weather.',data:'It restricts where the favorite is used; outside those purposes it is ignored.'},
        {name:'Monitor arrival and departure',what:'An optional geofence that notices when you arrive at or leave the place.',use:'Enable it only if you want arrival/departure suggestions; it needs background location and a native app.',data:'It depends on background opt-in and never runs external actions on its own. Without native support it stays inactive.'},
      ]},
      vehicles:{title:'Electric vehicles',how:'Profiles of your electric car to filter compatible chargers with suitable power.',fields:[
        {name:'Connectors and power',what:'The connector types (OCM) and power levels the car accepts and prefers.',use:'Fill it from the car manual; Jarvis filters chargers by it.',data:'Stored per user and used only to filter results. It does not confirm live availability.'},
        {name:'Default vehicle',what:'Which profile to use when you do not specify one.',use:'Mark the car you use day to day.',data:'Just a selection preference.'},
      ]},
      preferences:{title:'Explicit preferences',how:'Things you declare you like, avoid or require. They feed into the ranking of answers.',fields:[
        {name:'Category and preference',what:'The topic, like restaurant.cuisine, and the value, like regional food.',use:'Declare what matters; Jarvis prioritizes or avoids it based on the relation.',data:'Stored per user and used in ranking. You can edit or erase it anytime.'},
        {name:'Relation: prefer, avoid or require',what:'How the preference weighs: pulls for, against, or is mandatory.',use:'Use require only when it is a hard filter, like no stairs.',data:'It only affects ordering and filtering of results.'},
        {name:'Purposes and valid until',what:'Where the preference applies and an optional expiry.',use:'Limit it to the right purposes and set an expiry for something temporary.',data:'After the expiry it stops being used; cleanup follows retention.'},
      ]},
      retention:{title:'Retention and privacy',how:'Controls how long each type of data is kept and gathers the export and erase tools. It is the center of your privacy.',fields:[
        {name:'Observations, decisions and inferences (days)',what:'The retention window for each type of record.',use:'Lower it to keep data for less time; cleanup applies on the next prune.',data:'Past the window, records become eligible for automatic deletion.'},
        {name:'Keep raw location in history',what:'Whether the exact position enters history or only the reduced version.',use:'Leave it off for more privacy; turn it on only if you need precise history.',data:'Off, history keeps reduced location and the exact position stays temporary in the Hub.'},
        {name:'Export, prune and erase',what:'Download everything as JSON, remove expired data, or erase all.',use:'Export to take your data; Erase removes everything irreversibly.',data:'Export changes nothing; Erase is permanent and immediate.'},
        {name:'Erase a category',what:'Remove only one type of data, like preferences only.',use:'Use it for a targeted cleanup without losing the rest.',data:'Irreversible for the chosen category. Source configuration can only be erased by the owner.'},
      ]},
    });
    Object.assign(PERSONAL_HELP.es,{
      sources:{title:'Fuentes de contexto',how:'Las fuentes son de donde Jarvis toma contexto: mapas, agenda, eventos, clima, casa. Cada consulta usa solo las fuentes que consentiste para esa finalidad y muestra la procedencia del resultado.',fields:[
        {name:'Fuente de contexto',what:'Un proveedor de datos, como Nominatim para direcciones, CalDAV para agenda u Open-Meteo para clima.',use:'Activa las que quieras usar; Jarvis elige entre ellas según la finalidad de tu pregunta.',data:'La fuente se consulta solo cuando está activa y consentida, y el resultado trae la procedencia de quien respondió.'},
        {name:'Fuente activa',what:'Enciende o apaga una fuente específica.',use:'Desactívala para quitar una fuente de las consultas sin borrar su configuración.',data:'Desactivada, no se consulta ni contribuye a las respuestas.'},
        {name:'Probar, editar y eliminar',what:'Acciones sobre cada fuente de la lista.',use:'Probar comprueba que responde, Editar ajusta los campos y Eliminar la borra del todo.',data:'Probar hace una llamada real y descartable; Eliminar borra la configuración y los consentimientos ligados a ella.'},
      ]},
      consents:{title:'Consentimientos',how:'El consentimiento liga una fuente a una finalidad — movilidad, agenda, eventos, clima, casa. Sin consentimiento para la finalidad de la pregunta, la fuente no participa.',fields:[
        {name:'Consentimiento por finalidad',what:'La autorización de usar una fuente para un propósito específico.',use:'Concede solo las finalidades que tienen sentido y revoca cuando quieras.',data:'Guardado por usuario en el Hub. Revocar bloquea nuevos usos de inmediato; el historial sigue la retención definida en Datos.'},
      ]},
      configureSource:{title:'Configurar fuente',how:'Aquí el owner registra una fuente nueva. Los secretos quedan en variables del Hub y nunca vuelven al navegador.',fields:[
        {name:'Tipo',what:'Qué proveedor usa la fuente: CalDAV, Home Assistant, MCP, Open Charge Map, entre otros.',use:'Elige el tipo; los campos de abajo se ajustan a lo que necesita.',data:'Define el adaptador y las reglas de red y límite aplicadas a la fuente.'},
        {name:'Nombre',what:'Una etiqueta amigable para identificar la fuente en la lista.',use:'Dale un nombre claro, como "Agenda del trabajo".',data:'Es solo una etiqueta; no afecta la consulta.'},
        {name:'Endpoint',what:'La URL del servicio a consultar.',use:'Pega la URL del proveedor, por ejemplo el servidor CalDAV.',data:'Se valida contra las reglas de red (sin objetivos internos por defecto) y queda en la configuración de la fuente.'},
        {name:'Variable del secreto',what:'El nombre de la variable de entorno del Hub que guarda el token o la contraseña.',use:'Indica el nombre de la variable, como JARVIS_CALDAV_TOKEN — nunca el valor.',data:'El valor queda solo en el Hub; nunca se envía al navegador ni aparece en las respuestas.'},
        {name:'Recursos y acciones permitidos',what:'Limitan qué recursos y acciones puede exponer la fuente.',use:'Lista solo lo necesario, como "agenda" y "read".',data:'Funciona como techo: nada fuera de esa lista se lee ni se ejecuta.'},
        {name:'Opciones avanzadas',what:'Certificación MCP, formato del feed, acceso a la agenda, zona horaria, atributos y entorno del proceso stdio.',use:'Ajusta cuando el proveedor lo exija; el valor por defecto ya es el más restrictivo, como agenda solo ocupado/libre.',data:'Los detalles de agenda y el HTTPS remoto exigen una autorización explícita adicional.'},
      ]},
      personalData:{title:'Datos personales',how:'El resumen de lo que Jarvis guarda sobre ti y por cuánto tiempo. Todo es por usuario, y puedes exportar o borrar cuando quieras.',fields:[
        {name:'Resumen de datos',what:'El conteo de lo guardado por categoría: favoritos, preferencias, observaciones y más.',use:'Revisa aquí lo que existe antes de exportar o borrar.',data:'Solo lee lo que ya está en el Hub; nada se envía afuera.'},
        {name:'Categorías',what:'El agrupamiento de los datos por tipo.',use:'Úsalo para borrar una categoría específica más abajo, sin tocar el resto.',data:'Cada categoría sigue su propia ventana de retención definida en Retención.'},
      ]},
      favorites:{title:'Lugares favoritos',how:'Lugares que nombras, como casa y trabajo, para que Jarvis entienda referencias y calcule lo cercano o la ruta.',fields:[
        {name:'Nombre y dirección',what:'Un apodo y la ubicación del lugar.',use:'Ej.: "Casa" más la dirección; usa Buscar dirección o Usar ubicación actual.',data:'Guardado por usuario en el Hub y usado solo en las finalidades marcadas. Puedes borrarlo cuando quieras.'},
        {name:'Alias',what:'Otros nombres que usas para el mismo lugar.',use:'Ej.: "hogar", "mi casa" — ayuda a Jarvis a entenderte.',data:'Quedan junto al favorito y siguen la misma retención.'},
        {name:'Finalidades',what:'Para qué propósitos puede usarse el lugar.',use:'Marca, por ejemplo, movilidad y clima.',data:'Restringe dónde se usa el favorito; fuera de esas finalidades se ignora.'},
        {name:'Monitorear llegada y salida',what:'Un geofence opcional que nota cuando llegas o sales del lugar.',use:'Actívalo solo si quieres sugerencias por llegada/salida; requiere ubicación en segundo plano y app nativa.',data:'Depende del opt-in de segundo plano y nunca ejecuta acciones externas por sí solo. Sin soporte nativo queda inactivo.'},
      ]},
      vehicles:{title:'Vehículos eléctricos',how:'Perfiles de tu coche eléctrico para filtrar cargadores compatibles y con potencia adecuada.',fields:[
        {name:'Conectores y potencia',what:'Los tipos de conector (OCM) y las potencias que el coche acepta y prefiere.',use:'Complétalo según el manual del coche; Jarvis filtra los cargadores por ello.',data:'Guardado por usuario y usado solo para filtrar resultados. No confirma disponibilidad en vivo.'},
        {name:'Vehículo por defecto',what:'Qué perfil usar cuando no especificas uno.',use:'Marca el coche del día a día.',data:'Es solo una preferencia de selección.'},
      ]},
      preferences:{title:'Preferencias explícitas',how:'Cosas que declaras que te gustan, evitas o exiges. Entran en el ranking de las respuestas.',fields:[
        {name:'Categoría y preferencia',what:'El tema, como restaurante.cocina, y el valor, como comida regional.',use:'Declara lo que importa; Jarvis prioriza o evita según la relación.',data:'Guardado por usuario y usado en el ranking. Puedes editarlo o borrarlo cuando quieras.'},
        {name:'Relación: prefiero, evito o exijo',what:'Cómo pesa la preferencia: tira a favor, en contra, o es obligatoria.',use:'Usa exijo solo cuando sea un filtro rígido, como sin escaleras.',data:'Solo afecta el orden y el filtrado de resultados.'},
        {name:'Finalidades y válida hasta',what:'Dónde aplica la preferencia y una validez opcional.',use:'Limítala a las finalidades correctas y define validez para algo temporal.',data:'Tras la validez deja de usarse; la limpieza sigue la retención.'},
      ]},
      retention:{title:'Retención y privacidad',how:'Controla cuánto tiempo se conserva cada tipo de dato y reúne las herramientas de exportar y borrar. Es el centro de tu privacidad.',fields:[
        {name:'Observaciones, decisiones e inferencias (días)',what:'La ventana de retención de cada tipo de registro.',use:'Bájala para guardar menos tiempo; la limpieza aplica en la próxima poda.',data:'Pasado el plazo, los registros quedan elegibles para eliminación automática.'},
        {name:'Mantener ubicación bruta en el historial',what:'Si la posición exacta entra en el historial o solo la versión reducida.',use:'Déjalo apagado para más privacidad; enciéndelo solo si necesitas historial preciso.',data:'Apagado, el historial guarda ubicación reducida y la posición exacta queda temporal en el Hub.'},
        {name:'Exportar, limpiar y borrar',what:'Descargar todo en JSON, quitar lo expirado, o borrar todo.',use:'Exporta para llevarte tus datos; Borrar quita todo de forma irreversible.',data:'Exportar no cambia nada; Borrar es definitivo e inmediato.'},
        {name:'Borrar una categoría',what:'Quitar solo un tipo de dato, como solo preferencias.',use:'Úsalo para una limpieza puntual sin perder el resto.',data:'Es irreversible para la categoría elegida. La configuración de fuentes solo la borra el owner.'},
      ]},
    });
    Object.assign(PERSONAL_HELP.pt,{
      geral:{title:'Configurações gerais',how:'Preferências básicas do Jarvis aplicadas às conversas novas.',fields:[
        {name:'Idioma',what:'Idioma da interface (Português, English, Español).',use:'Escolha o idioma; a interface muda na hora.',data:'Fica salvo neste navegador/aparelho; não afeta outros dispositivos.'},
        {name:'Agente, modelo e esforço padrão',what:'A IA, o modelo e o nível de esforço usados por padrão em conversas novas.',use:'Defina o que prefere; cada conversa pode sobrescrever no seletor do compositor.',data:'Salvo localmente; não muda conversas já abertas.'},
        {name:'Autocomplete (/ @ # !)',what:'Liga o menu de sugestões ao digitar barra, arroba, cerquilha ou exclamação.',use:'Desligue se preferir digitar sem o popup.',data:'Preferência local; não envia nada.'},
      ]},
      voz:{title:'Voz',how:'Fala do Jarvis, microfone, wake word e identificação por voz. Cada aparelho tem as suas preferências.',fields:[
        {name:'Falar respostas',what:'Se o Jarvis lê as respostas em voz alta.',use:'Ative para ouvir; escolha o timbre no catálogo abaixo.',data:'Preferência do aparelho; o áudio é gerado sob demanda, não fica salvo.'},
        {name:'Catálogo de vozes (timbre)',what:'A voz usada na fala (homem/mulher, PT/EN/ES).',use:'Toque para ouvir uma prévia e escolher.',data:'Apenas seleção; nada é gravado.'},
        {name:'Escuta contínua e silêncio',what:'Continua ouvindo após responder e corta a gravação por pausa.',use:'Ajuste o tempo de silêncio (segundos) que encerra a fala.',data:'Controla a captura; nada é enviado sem você falar.'},
        {name:'Wake word (hey jarvis)',what:'Ativa a detecção da frase de ativação.',use:'Ligue para acordar por voz; no Android exige o app nativo e permissão de microfone.',data:'A detecção roda no aparelho; o áudio não sai antes do wake.'},
        {name:'Supressão de ruído',what:'Reduz ruído de fundo na captura.',use:'Ligue em ambientes barulhentos.',data:'Processamento local do áudio.'},
        {name:'Exigir voz cadastrada',what:'Bloqueia vozes desconhecidas no modo voz (multiusuário).',use:'Cadastre a sua voz antes de exigir, senão o modo voz trava.',data:'A impressão de voz fica no Hub, por usuário, e pode ser removida.'},
      ]},
      notif:{title:'Notificações',how:'Como e quando este aparelho recebe push. Cada aparelho decide o seu.',fields:[
        {name:'Receber push',what:'Liga as notificações neste aparelho.',use:'Ative e conceda a permissão do sistema.',data:'Cria uma inscrição push por aparelho; pode desativar quando quiser.'},
        {name:'Eventos (concluído, falha, máquina)',what:'Quais eventos geram notificação.',use:'Marque só o que te interessa.',data:'Preferência por aparelho; não muda o que acontece no Hub.'},
        {name:'Modo e intervalo',what:'Uma notificação por evento ou um resumo a cada X minutos.',use:'Use agrupado para reduzir o barulho.',data:'Só controla a entrega; nada é coletado.'},
        {name:'Bloqueio biométrico',what:'Exige biometria para abrir a partir da notificação.',use:'Ligue para mais segurança neste aparelho.',data:'A biometria é do sistema; o Jarvis não a armazena.'},
      ]},
      automacao:{title:'Automação',how:'Rotinas agendadas, política adaptativa e limites de execução de subagentes (área do dono).',fields:[
        {name:'Agenda de rotinas',what:'Tarefas que rodam sozinhas num horário.',use:'Aceita cron de 5 campos ou frases como “a cada 3 horas”; o resultado mostra o horário real.',data:'As rotinas ficam no Hub e rodam na máquina escolhida.'},
        {name:'Política adaptativa',what:'Regras de quando pedir a sua aprovação (custo, tokens, escrita no repo, etc.).',use:'Ajuste os limites; a política vale por projeto e por sessão.',data:'Guardada no Hub; define o que roda sozinho vs. o que espera você.'},
        {name:'Execução de subagentes',what:'Limites de concorrência, profundidade, retenção e escrita padrão.',use:'Aumente com cuidado — mais concorrência consome mais recursos.',data:'Configuração do Hub; vale para trabalhos em segundo plano.'},
      ]},
      framework:{title:'Framework',how:'Comandos, skills e instruções universais compartilhados entre as IAs e publicáveis nas máquinas (área do dono).',fields:[
        {name:'Preferência do framework',what:'Se os comandos “/x” expandem sempre, sob pedido, ou nunca.',use:'Escolha conforme o seu fluxo.',data:'Preferência do Hub.'},
        {name:'Configurado hoje',what:'Inventário por arquivo: tipo, custo de token e o que mudou desde a última publicação.',use:'Confira o que está ativo, o que é novo/alterado e o orçamento de token (o sempre-ligado degrada acima de ~2k).',data:'Lido do Hub e comparado ao último snapshot publicado.'},
        {name:'Editor e arquivos',what:'Onde você cria e edita os comandos, skills e instruções.',use:'Edite e salve; depois publique.',data:'Guardado no Hub e versionado.'},
        {name:'Importar pacote (.zip / GitHub)',what:'Traz comandos/skills/instruções de um zip ou repositório GitHub público.',use:'Suba o zip ou informe owner/repo; revise a prévia (scan de segurança + validação + token) e confirme.',data:'Nada é escrito sem confirmação; achados altos bloqueiam até override.'},
        {name:'Verificação de segurança',what:'Scan estático dos vetores conhecidos (execução dinâmica, shell amplo, credenciais, exfiltração, injeção).',use:'Leia os achados antes de aplicar. Reduz risco, não substitui a sua revisão.',data:'Local, sem enviar o conteúdo para fora.'},
        {name:'Fontes e atualização',what:'Repositórios GitHub já importados e busca de atualização.',use:'Use “Buscar atualização” para ver a diferença antes de sobrescrever.',data:'Proveniência guardada no Hub (owner/repo/commit/hash).'},
        {name:'Publicar nas máquinas',what:'Distribui a versão atual para os runners.',use:'Publique após editar; o status por máquina aparece abaixo.',data:'Envia aos runners conectados; quem está offline recebe ao voltar.'},
      ]},
      rota:{title:'Roteamento',how:'A IA que roda no servidor (Hub) para o modo Automático, resumos e consultas de status.',fields:[
        {name:'IA, modelo e esforço do roteamento',what:'Qual IA analisa mensagens em Automático e faz resumos e status.',use:'Prefira um modelo econômico — roda com frequência.',data:'Salvo no Hub; auto-salva ao mudar (não tem botão Salvar).'},
      ]},
      uso:{title:'Uso e custo',how:'Consumo e custo por sessão e por máquina. É só leitura.',fields:[
        {name:'Uso e custo',what:'Tokens e custo estimado acumulados.',use:'Acompanhe o gasto por sessão e por máquina.',data:'Somente leitura; nada é alterado aqui.'},
      ]},
      celular:{title:'Abrir no celular',how:'Abra esta instância do Jarvis no seu telefone.',fields:[
        {name:'Link e QR',what:'Endereço (Tailscale) e QR para abrir no celular.',use:'Aponte a câmera com o Tailscale ligado, ou copie o link.',data:'O link aponta para o seu Hub; use só em rede confiável.'},
      ]},
      dispositivos:{title:'Dispositivos e convites',how:'Aparelhos autorizados, convites e credenciais de acesso (área do dono).',fields:[
        {name:'Aparelhos autorizados',what:'Dispositivos que podem acessar o Jarvis.',use:'Revise e revogue o que não reconhecer.',data:'Guardado no Hub; revogar bloqueia o acesso na hora.'},
        {name:'Convites',what:'Códigos para dar acesso a novos aparelhos.',use:'Gere um convite e compartilhe com segurança.',data:'Convites expiram; trate como senha.'},
      ]},
      update:{title:'Atualização',how:'Verificação e aplicação de atualizações do Hub e dos runners.',fields:[
        {name:'Atualização do Hub e runners',what:'Checa e aplica novas versões.',use:'Verifique e aplique; máquinas offline recebem ao voltar.',data:'Aplicar reinicia o serviço; o estado é preservado.'},
      ]},
      solutions:{title:'Espaço de Soluções',how:'Roda um problema por várias IAs em paralelo e combina os resultados. Escolha o modo conforme o objetivo.',fields:[
        {name:'Conselho',what:'Várias IAs deliberam e sintetizam uma resposta única.',use:'Use para decisões e planos onde perspectivas diferentes ajudam.',data:'Cada IA vê o mesmo enunciado; o resultado é uma síntese.'},
        {name:'Torneio / Benchmark',what:'Compara execuções (IAs ou modelos diferentes) lado a lado.',use:'Use para escolher a melhor abordagem ou modelo.',data:'Roda N execuções e mostra o comparativo.'},
        {name:'Revisão',what:'Cada IA acha problemas complementares no mesmo alvo.',use:'Use para um code review multi-lente.',data:'Combina os achados; você decide o que aplicar.'},
        {name:'Auditoria',what:'Foca em severidade e evidência dos achados.',use:'Use quando precisar priorizar por risco.',data:'Classifica por severidade com justificativa.'},
      ]},
    });
    Object.assign(PERSONAL_HELP.en,{
      geral:{title:'General settings',how:'Basic Jarvis preferences applied to new conversations.',fields:[
        {name:'Language',what:'Interface language (Português, English, Español).',use:'Pick the language; the UI switches instantly.',data:'Stored on this browser/device; does not affect others.'},
        {name:'Default agent, model and effort',what:'The AI, model and effort level used by default in new conversations.',use:'Set your preference; each conversation can override it in the composer selector.',data:'Stored locally; it does not change already-open conversations.'},
        {name:'Autocomplete (/ @ # !)',what:'Turns on the suggestion menu when typing slash, at, hash or bang.',use:'Turn it off if you prefer typing without the popup.',data:'Local preference; it sends nothing.'},
      ]},
      voz:{title:'Voice',how:'Jarvis speech, microphone, wake word and voice identification. Each device has its own preferences.',fields:[
        {name:'Speak replies',what:'Whether Jarvis reads replies out loud.',use:'Enable it to listen; pick the timbre in the catalog below.',data:'Device preference; audio is generated on demand, not stored.'},
        {name:'Voice catalog (timbre)',what:'The voice used for speech (male/female, PT/EN/ES).',use:'Tap to hear a preview and choose.',data:'Selection only; nothing is recorded.'},
        {name:'Continuous listening and silence',what:'Keeps listening after replying and trims the recording on a pause.',use:'Adjust the silence time (seconds) that ends the utterance.',data:'Controls capture; nothing is sent unless you speak.'},
        {name:'Wake word (hey jarvis)',what:'Turns on detection of the activation phrase.',use:'Enable to wake by voice; on Android it needs the native app and microphone permission.',data:'Detection runs on the device; audio does not leave before the wake.'},
        {name:'Noise suppression',what:'Reduces background noise in the capture.',use:'Turn it on in noisy places.',data:'Local audio processing.'},
        {name:'Require enrolled voice',what:'Blocks unknown voices in voice mode (multi-user).',use:'Enroll your voice before requiring it, or voice mode locks.',data:'The voiceprint stays in the Hub, per user, and can be removed.'},
      ]},
      notif:{title:'Notifications',how:'How and when this device receives push. Each device decides its own.',fields:[
        {name:'Receive push',what:'Turns notifications on for this device.',use:'Enable it and grant the system permission.',data:'Creates a push subscription per device; you can disable it anytime.'},
        {name:'Events (done, failure, machine)',what:'Which events trigger a notification.',use:'Check only what matters to you.',data:'Per-device preference; it does not change what happens in the Hub.'},
        {name:'Mode and interval',what:'One notification per event or a summary every X minutes.',use:'Use grouped to reduce noise.',data:'Delivery control only; nothing is collected.'},
        {name:'Biometric lock',what:'Requires biometrics to open from the notification.',use:'Enable it for more security on this device.',data:'Biometrics belong to the OS; Jarvis does not store them.'},
      ]},
      automacao:{title:'Automation',how:'Scheduled routines, adaptive policy and subagent execution limits (owner area).',fields:[
        {name:'Routine schedule',what:'Tasks that run on their own at a schedule.',use:'Accepts 5-field cron or phrases like "every 3 hours"; the result shows the real time.',data:'Routines live in the Hub and run on the chosen machine.'},
        {name:'Adaptive policy',what:'Rules for when to ask for your approval (cost, tokens, repo writes, etc.).',use:'Adjust the limits; the policy applies per project and per session.',data:'Stored in the Hub; it defines what runs on its own vs. what waits for you.'},
        {name:'Subagent execution',what:'Limits for concurrency, depth, retention and default write.',use:'Raise carefully — more concurrency uses more resources.',data:'Hub configuration; applies to background work.'},
      ]},
      framework:{title:'Framework',how:'Universal commands, skills and instructions shared across AIs and publishable to machines (owner area).',fields:[
        {name:'Framework preference',what:'Whether "/x" commands expand always, on request, or never.',use:'Choose per your workflow.',data:'Hub preference.'},
        {name:'Editor and files',what:'Where you create and edit commands, skills and instructions.',use:'Edit and save; then publish.',data:'Stored in the Hub and versioned.'},
        {name:'Publish to machines',what:'Distributes the current version to the runners.',use:'Publish after editing; per-machine status appears below.',data:'Sent to connected runners; offline ones receive it when back.'},
      ]},
      rota:{title:'Routing',how:'The AI that runs on the server (Hub) for Automatic mode, summaries and status queries.',fields:[
        {name:'Routing AI, model and effort',what:'Which AI analyzes messages in Automatic and does summaries and status.',use:'Prefer an economical model — it runs often.',data:'Stored in the Hub; auto-saves on change (no Save button).'},
      ]},
      uso:{title:'Usage and cost',how:'Consumption and cost per session and per machine. Read-only.',fields:[
        {name:'Usage and cost',what:'Accumulated tokens and estimated cost.',use:'Track spend per session and per machine.',data:'Read-only; nothing is changed here.'},
      ]},
      celular:{title:'Open on phone',how:'Open this Jarvis instance on your phone.',fields:[
        {name:'Link and QR',what:'Address (Tailscale) and QR to open on the phone.',use:'Point the camera with Tailscale on, or copy the link.',data:'The link points to your Hub; use it only on a trusted network.'},
      ]},
      dispositivos:{title:'Devices and invites',how:'Authorized devices, invites and access credentials (owner area).',fields:[
        {name:'Authorized devices',what:'Devices allowed to access Jarvis.',use:'Review and revoke anything you do not recognize.',data:'Stored in the Hub; revoking blocks access immediately.'},
        {name:'Invites',what:'Codes to grant access to new devices.',use:'Generate an invite and share it securely.',data:'Invites expire; treat them like a password.'},
      ]},
      update:{title:'Update',how:'Checking and applying Hub and runner updates.',fields:[
        {name:'Hub and runner update',what:'Checks and applies new versions.',use:'Check and apply; offline machines receive it when back.',data:'Applying restarts the service; state is preserved.'},
      ]},
      solutions:{title:'Solution Workspace',how:'Run one problem across several AIs in parallel and combine the results. Pick the mode by goal.',fields:[
        {name:'Council',what:'Several AIs deliberate and synthesize one answer.',use:'Use it for decisions and plans where different perspectives help.',data:'Each AI sees the same prompt; the result is a synthesis.'},
        {name:'Tournament / Benchmark',what:'Compares executions (different AIs or models) side by side.',use:'Use it to pick the best approach or model.',data:'Runs N executions and shows the comparison.'},
        {name:'Review',what:'Each AI finds complementary issues on the same target.',use:'Use it for a multi-lens code review.',data:'Combines findings; you decide what to apply.'},
        {name:'Audit',what:'Focuses on severity and evidence of findings.',use:'Use it when you need to prioritize by risk.',data:'Ranks by severity with justification.'},
      ]},
    });
    Object.assign(PERSONAL_HELP.es,{
      geral:{title:'Configuración general',how:'Preferencias básicas de Jarvis aplicadas a las conversaciones nuevas.',fields:[
        {name:'Idioma',what:'Idioma de la interfaz (Português, English, Español).',use:'Elige el idioma; la interfaz cambia al instante.',data:'Se guarda en este navegador/dispositivo; no afecta a otros.'},
        {name:'Agente, modelo y esfuerzo por defecto',what:'La IA, el modelo y el nivel de esfuerzo usados por defecto en conversaciones nuevas.',use:'Define tu preferencia; cada conversación puede sobrescribirla en el selector del compositor.',data:'Guardado localmente; no cambia las conversaciones ya abiertas.'},
        {name:'Autocompletado (/ @ # !)',what:'Activa el menú de sugerencias al escribir barra, arroba, almohadilla o exclamación.',use:'Desactívalo si prefieres escribir sin el popup.',data:'Preferencia local; no envía nada.'},
      ]},
      voz:{title:'Voz',how:'Habla de Jarvis, micrófono, wake word e identificación por voz. Cada dispositivo tiene sus preferencias.',fields:[
        {name:'Leer respuestas',what:'Si Jarvis lee las respuestas en voz alta.',use:'Actívalo para escuchar; elige el timbre en el catálogo.',data:'Preferencia del dispositivo; el audio se genera bajo demanda, no se guarda.'},
        {name:'Catálogo de voces (timbre)',what:'La voz usada para hablar (hombre/mujer, PT/EN/ES).',use:'Toca para oír una vista previa y elegir.',data:'Solo selección; no se graba nada.'},
        {name:'Escucha continua y silencio',what:'Sigue escuchando tras responder y corta la grabación por pausa.',use:'Ajusta el tiempo de silencio (segundos) que termina el habla.',data:'Controla la captura; no se envía nada sin que hables.'},
        {name:'Wake word (hey jarvis)',what:'Activa la detección de la frase de activación.',use:'Actívalo para despertar por voz; en Android exige la app nativa y permiso de micrófono.',data:'La detección corre en el dispositivo; el audio no sale antes del wake.'},
        {name:'Supresión de ruido',what:'Reduce el ruido de fondo en la captura.',use:'Actívalo en lugares ruidosos.',data:'Procesamiento local del audio.'},
        {name:'Exigir voz registrada',what:'Bloquea voces desconocidas en modo voz (multiusuario).',use:'Registra tu voz antes de exigirla, o el modo voz se bloquea.',data:'La huella de voz queda en el Hub, por usuario, y se puede eliminar.'},
      ]},
      notif:{title:'Notificaciones',how:'Cómo y cuándo este dispositivo recibe push. Cada uno decide el suyo.',fields:[
        {name:'Recibir push',what:'Activa las notificaciones en este dispositivo.',use:'Actívalo y concede el permiso del sistema.',data:'Crea una suscripción push por dispositivo; puedes desactivarla cuando quieras.'},
        {name:'Eventos (finalizado, fallo, máquina)',what:'Qué eventos generan notificación.',use:'Marca solo lo que te interesa.',data:'Preferencia por dispositivo; no cambia lo que ocurre en el Hub.'},
        {name:'Modo e intervalo',what:'Una notificación por evento o un resumen cada X minutos.',use:'Usa agrupado para reducir el ruido.',data:'Solo controla la entrega; no se recopila nada.'},
        {name:'Bloqueo biométrico',what:'Exige biometría para abrir desde la notificación.',use:'Actívalo para más seguridad en este dispositivo.',data:'La biometría es del sistema; Jarvis no la almacena.'},
      ]},
      automacao:{title:'Automatización',how:'Rutinas programadas, política adaptativa y límites de ejecución de subagentes (área del dueño).',fields:[
        {name:'Agenda de rutinas',what:'Tareas que se ejecutan solas en un horario.',use:'Acepta cron de 5 campos o frases como "cada 3 horas"; el resultado muestra la hora real.',data:'Las rutinas viven en el Hub y corren en la máquina elegida.'},
        {name:'Política adaptativa',what:'Reglas de cuándo pedir tu aprobación (costo, tokens, escritura en el repo, etc.).',use:'Ajusta los límites; la política aplica por proyecto y por sesión.',data:'Guardada en el Hub; define qué corre solo vs. qué te espera.'},
        {name:'Ejecución de subagentes',what:'Límites de concurrencia, profundidad, retención y escritura por defecto.',use:'Sube con cuidado — más concurrencia consume más recursos.',data:'Configuración del Hub; aplica al trabajo en segundo plano.'},
      ]},
      framework:{title:'Framework',how:'Comandos, skills e instrucciones universales compartidos entre las IAs y publicables en las máquinas (área del dueño).',fields:[
        {name:'Preferencia del framework',what:'Si los comandos "/x" se expanden siempre, a petición, o nunca.',use:'Elige según tu flujo.',data:'Preferencia del Hub.'},
        {name:'Editor y archivos',what:'Donde creas y editas comandos, skills e instrucciones.',use:'Edita y guarda; luego publica.',data:'Guardado en el Hub y versionado.'},
        {name:'Publicar en las máquinas',what:'Distribuye la versión actual a los runners.',use:'Publica tras editar; el estado por máquina aparece abajo.',data:'Se envía a los runners conectados; los offline lo reciben al volver.'},
      ]},
      rota:{title:'Ruteo',how:'La IA que corre en el servidor (Hub) para el modo Automático, resúmenes y consultas de estado.',fields:[
        {name:'IA, modelo y esfuerzo del ruteo',what:'Qué IA analiza mensajes en Automático y hace resúmenes y estado.',use:'Prefiere un modelo económico — corre a menudo.',data:'Guardado en el Hub; se autoguarda al cambiar (sin botón Guardar).'},
      ]},
      uso:{title:'Uso y costo',how:'Consumo y costo por sesión y por máquina. Solo lectura.',fields:[
        {name:'Uso y costo',what:'Tokens y costo estimado acumulados.',use:'Sigue el gasto por sesión y por máquina.',data:'Solo lectura; aquí no se cambia nada.'},
      ]},
      celular:{title:'Abrir en el móvil',how:'Abre esta instancia de Jarvis en tu teléfono.',fields:[
        {name:'Enlace y QR',what:'Dirección (Tailscale) y QR para abrir en el móvil.',use:'Apunta la cámara con Tailscale encendido, o copia el enlace.',data:'El enlace apunta a tu Hub; úsalo solo en una red de confianza.'},
      ]},
      dispositivos:{title:'Dispositivos e invitaciones',how:'Dispositivos autorizados, invitaciones y credenciales de acceso (área del dueño).',fields:[
        {name:'Dispositivos autorizados',what:'Dispositivos que pueden acceder a Jarvis.',use:'Revisa y revoca lo que no reconozcas.',data:'Guardado en el Hub; revocar bloquea el acceso al instante.'},
        {name:'Invitaciones',what:'Códigos para dar acceso a nuevos dispositivos.',use:'Genera una invitación y compártela con seguridad.',data:'Las invitaciones expiran; trátalas como una contraseña.'},
      ]},
      update:{title:'Actualización',how:'Verificación y aplicación de actualizaciones del Hub y de los runners.',fields:[
        {name:'Actualización del Hub y runners',what:'Comprueba y aplica nuevas versiones.',use:'Verifica y aplica; las máquinas offline la reciben al volver.',data:'Aplicar reinicia el servicio; el estado se preserva.'},
      ]},
      solutions:{title:'Espacio de Soluciones',how:'Ejecuta un problema en varias IAs en paralelo y combina los resultados. Elige el modo según el objetivo.',fields:[
        {name:'Consejo',what:'Varias IAs deliberan y sintetizan una respuesta única.',use:'Úsalo para decisiones y planes donde ayudan perspectivas distintas.',data:'Cada IA ve el mismo enunciado; el resultado es una síntesis.'},
        {name:'Torneo / Benchmark',what:'Compara ejecuciones (IAs o modelos distintos) lado a lado.',use:'Úsalo para elegir el mejor enfoque o modelo.',data:'Corre N ejecuciones y muestra la comparación.'},
        {name:'Revisión',what:'Cada IA encuentra problemas complementarios en el mismo objetivo.',use:'Úsalo para un code review multi-lente.',data:'Combina los hallazgos; tú decides qué aplicar.'},
        {name:'Auditoría',what:'Se centra en severidad y evidencia de los hallazgos.',use:'Úsalo cuando necesites priorizar por riesgo.',data:'Clasifica por severidad con justificación.'},
      ]},
    });
    Object.assign(I18N.pt,{close:'Fechar',listView:'Lista',mapView:'Mapa',resultsMap:'Mapa dos resultados',confirmAction:'Confirmar ação',proactiveThisDevice:'Receber sugestões proativas neste aparelho',proactiveDeviceOn:'Ativadas neste aparelho.',proactiveDeviceOff:'Desativadas neste aparelho.',proactiveSaved:'Preferência deste aparelho salva.',favoriteAliases:'Aliases',favoriteAliasesPh:'casa, lar',favoritePurposes:'Finalidades',latitude:'Latitude',longitude:'Longitude',cancelEdit:'Cancelar edição',editFavorite:'Editar local',detectFormat:'Detectar',busyFreeOnly:'Somente ocupado/livre',authorizedDetails:'Detalhes autorizados',personalTurnTitle:'Sugestões do assistente pessoal',personalSuggestionsAvailable:'Sugestões pessoais disponíveis',openSuggestions:'Ver no assistente',proactiveOpen:'Abrir sugestão',nativeContextUnavailable:'Contexto nativo indisponível neste aparelho.',nativeContextWeb:'Contexto via recursos do navegador.',nativeForeground:'localização foreground',nativeCalendar:'agenda ocupado/livre',nativeGeofences:'geofences',nativeBackground:'background',nativeTransitions:'transições drenadas',sourceTesting:'Testando fonte...',arrivalMonitoring:'Monitorar chegada e saída',monitorFavorite:'Monitorar este local em background',geofenceRadius:'Raio (metros)',geofenceTransitions:'Transições',arrival:'Chegada',departure:'Saída',geofenceOptInNote:'Exige opt-in de background e suporte nativo; não executa ações externas automaticamente.',geofenceSavedWaiting:'Monitoramento salvo; autorize background neste aparelho para ativá-lo.',geofenceActive:'Monitoramento nativo sincronizado.',geofenceUnsupported:'Este aparelho não oferece monitoramento por geofence.',policyPersonalContext:'Permitir contexto pessoal automático no chat',hPolicyPersonalContext:'Quando ativado, o chat pode consultar somente o contexto pessoal consentido. Ligar o assistente não ativa esta opção automaticamente.',personalContextBlockedShort:'O contexto pessoal no chat está desativado pela política — toque para permitir.',personalContextPolicyTitle:'Permitir contexto pessoal no chat?',personalContextPolicyBody:'Para o assistente realmente consultar seu contexto no chat, é preciso uma permissão à parte da política. Com ela, o chat pode usar apenas o contexto pessoal que você consentiu. Você pode desligar depois em Automação.',personalContextPolicyEnable:'Permitir',personalContextPolicyEnabledToast:'Contexto pessoal no chat permitido.'});
    Object.assign(I18N.en,{close:'Close',listView:'List',mapView:'Map',resultsMap:'Results map',confirmAction:'Confirm action',proactiveThisDevice:'Receive proactive suggestions on this device',proactiveDeviceOn:'Enabled on this device.',proactiveDeviceOff:'Disabled on this device.',proactiveSaved:'This device preference was saved.',favoriteAliases:'Aliases',favoriteAliasesPh:'home, my place',favoritePurposes:'Purposes',latitude:'Latitude',longitude:'Longitude',cancelEdit:'Cancel edit',editFavorite:'Edit place',detectFormat:'Detect',busyFreeOnly:'Busy/free only',authorizedDetails:'Authorized details',personalTurnTitle:'Personal assistant suggestions',personalSuggestionsAvailable:'Personal suggestions available',openSuggestions:'View in assistant',proactiveOpen:'Open suggestion',nativeContextUnavailable:'Native context is unavailable on this device.',nativeContextWeb:'Context through browser capabilities.',nativeForeground:'foreground location',nativeCalendar:'busy/free calendar',nativeGeofences:'geofences',nativeBackground:'background',nativeTransitions:'transitions drained',sourceTesting:'Testing source...',arrivalMonitoring:'Monitor arrivals and departures',monitorFavorite:'Monitor this place in the background',geofenceRadius:'Radius (meters)',geofenceTransitions:'Transitions',arrival:'Arrival',departure:'Departure',geofenceOptInNote:'Requires background opt-in and native support; it never runs external actions automatically.',geofenceSavedWaiting:'Monitoring saved; authorize background on this device to activate it.',geofenceActive:'Native monitoring synchronized.',geofenceUnsupported:'This device does not support geofence monitoring.',policyPersonalContext:'Allow automatic personal context in chat',hPolicyPersonalContext:'When enabled, chat may query only consented personal context. Enabling the assistant does not enable this option automatically.',personalContextBlockedShort:'Personal context in chat is off by policy — tap to allow.',personalContextPolicyTitle:'Allow personal context in chat?',personalContextPolicyBody:'For the assistant to actually use your context in chat, a separate policy permission is required. With it, chat can use only the personal context you consented to. You can turn it off later in Automation.',personalContextPolicyEnable:'Allow',personalContextPolicyEnabledToast:'Personal context in chat allowed.'});
    Object.assign(I18N.es,{close:'Cerrar',listView:'Lista',mapView:'Mapa',resultsMap:'Mapa de resultados',confirmAction:'Confirmar acción',proactiveThisDevice:'Recibir sugerencias proactivas en este dispositivo',proactiveDeviceOn:'Activadas en este dispositivo.',proactiveDeviceOff:'Desactivadas en este dispositivo.',proactiveSaved:'Se guardó la preferencia de este dispositivo.',favoriteAliases:'Alias',favoriteAliasesPh:'casa, hogar',favoritePurposes:'Finalidades',latitude:'Latitud',longitude:'Longitud',cancelEdit:'Cancelar edición',editFavorite:'Editar lugar',detectFormat:'Detectar',busyFreeOnly:'Solo ocupado/libre',authorizedDetails:'Detalles autorizados',personalTurnTitle:'Sugerencias del asistente personal',personalSuggestionsAvailable:'Sugerencias personales disponibles',openSuggestions:'Ver en el asistente',proactiveOpen:'Abrir sugerencia',nativeContextUnavailable:'El contexto nativo no está disponible en este dispositivo.',nativeContextWeb:'Contexto mediante capacidades del navegador.',nativeForeground:'ubicación foreground',nativeCalendar:'agenda ocupado/libre',nativeGeofences:'geofences',nativeBackground:'background',nativeTransitions:'transiciones drenadas',sourceTesting:'Probando fuente...',arrivalMonitoring:'Monitorear llegadas y salidas',monitorFavorite:'Monitorear este lugar en segundo plano',geofenceRadius:'Radio (metros)',geofenceTransitions:'Transiciones',arrival:'Llegada',departure:'Salida',geofenceOptInNote:'Requiere opt-in de segundo plano y soporte nativo; nunca ejecuta acciones externas automáticamente.',geofenceSavedWaiting:'Monitoreo guardado; autoriza segundo plano en este dispositivo para activarlo.',geofenceActive:'Monitoreo nativo sincronizado.',geofenceUnsupported:'Este dispositivo no soporta monitoreo por geofence.',policyPersonalContext:'Permitir contexto personal automático en el chat',hPolicyPersonalContext:'Cuando está activo, el chat puede consultar solo contexto personal consentido. Activar el asistente no activa esta opción automáticamente.',personalContextBlockedShort:'El contexto personal en el chat está desactivado por política — toca para permitir.',personalContextPolicyTitle:'¿Permitir contexto personal en el chat?',personalContextPolicyBody:'Para que el asistente use tu contexto en el chat, hace falta un permiso aparte de la política. Con él, el chat solo usa el contexto personal que consentiste. Puedes desactivarlo luego en Automatización.',personalContextPolicyEnable:'Permitir',personalContextPolicyEnabledToast:'Contexto personal en el chat permitido.'});
    Object.assign(I18N.pt,{electricVehicles:'Veículos elétricos',vehicleProfileNote:'Perfis filtram compatibilidade e potência. Eles não confirmam disponibilidade ao vivo de carregadores.',configureVehicle:'Configurar veículo',vehicleId:'ID',vehicleIdPh:'meu-carro',vehicleLabel:'Nome',connectorTypeIds:'Conectores OCM',connectorTypeIdsPh:'25, 33',maxAcceptedPower:'Potência máxima aceita (kW)',vehicleRange:'Autonomia estimada (km)',minimumPreferredPower:'Potência mínima preferida (kW)',preferredOperators:'Operadores preferidos',preferredOperatorsPh:'Operador A, Operador B',defaultVehicle:'Veículo padrão',saveVehicle:'Salvar veículo',noVehicles:'Nenhum veículo configurado.',vehicleSaved:'Perfil de veículo salvo.',vehicleHelp:'Use IDs numéricos de tipos de conector do Open Charge Map. Potência, autonomia e operadores servem para ordenar opções; disponibilidade ao vivo depende da fonte consultada.'});
    Object.assign(I18N.en,{electricVehicles:'Electric vehicles',vehicleProfileNote:'Profiles filter compatibility and power. They do not confirm live charger availability.',configureVehicle:'Configure vehicle',vehicleId:'ID',vehicleIdPh:'my-car',vehicleLabel:'Name',connectorTypeIds:'OCM connectors',connectorTypeIdsPh:'25, 33',maxAcceptedPower:'Maximum accepted power (kW)',vehicleRange:'Estimated range (km)',minimumPreferredPower:'Minimum preferred power (kW)',preferredOperators:'Preferred operators',preferredOperatorsPh:'Operator A, Operator B',defaultVehicle:'Default vehicle',saveVehicle:'Save vehicle',noVehicles:'No vehicles configured.',vehicleSaved:'Vehicle profile saved.',vehicleHelp:'Use numeric Open Charge Map connector type IDs. Power, range and operators rank options; live availability depends on the queried source.'});
    Object.assign(I18N.es,{electricVehicles:'Vehículos eléctricos',vehicleProfileNote:'Los perfiles filtran compatibilidad y potencia. No confirman disponibilidad en vivo de cargadores.',configureVehicle:'Configurar vehículo',vehicleId:'ID',vehicleIdPh:'mi-auto',vehicleLabel:'Nombre',connectorTypeIds:'Conectores OCM',connectorTypeIdsPh:'25, 33',maxAcceptedPower:'Potencia máxima aceptada (kW)',vehicleRange:'Autonomía estimada (km)',minimumPreferredPower:'Potencia mínima preferida (kW)',preferredOperators:'Operadores preferidos',preferredOperatorsPh:'Operador A, Operador B',defaultVehicle:'Vehículo predeterminado',saveVehicle:'Guardar vehículo',noVehicles:'No hay vehículos configurados.',vehicleSaved:'Perfil de vehículo guardado.',vehicleHelp:'Usa IDs numéricos de tipos de conector de Open Charge Map. Potencia, autonomía y operadores ordenan opciones; la disponibilidad en vivo depende de la fuente consultada.'});
    Object.assign(I18N.pt,{favoriteSaved:'Local favorito salvo.',proactiveLoaded:'Sugestão aberta.',eraseCategory:'Apagar uma categoria',eraseSelected:'Apagar',categoryObservations:'Observações',categoryPreferences:'Preferências',categoryFavorites:'Locais favoritos',categoryVehicleProfiles:'Perfis de veículos',categoryActions:'Ações',categoryNotifications:'Notificações',categorySources:'Configurações de fontes',categoryConsents:'Consentimentos',categoryDeviceProfiles:'Preferências de aparelhos',categoryEraseNote:'A configuração de fontes só pode ser apagada pelo owner.',categoryEraseHelp:'Apaga apenas a categoria selecionada após confirmação. Fontes exigem owner; apagar favoritos também desativa seus geofences.',categoryEraseConfirm:'Apagar esta categoria permanentemente?',categoryEraseIrreversible:'Esta ação não pode ser desfeita.',categoryEraseDone:'Categoria apagada.',categoryEffectObservations:'Remove observações, inclusive histórico de localização e transições já registradas.',categoryEffectPreferences:'Remove preferências explícitas e inferidas.',categoryEffectFavorites:'Remove todos os locais favoritos e desativa seus geofences neste aparelho.',categoryEffectVehicleProfiles:'Remove todos os perfis de veículos elétricos.',categoryEffectActions:'Cancela ações em andamento quando possível e remove o histórico de ações.',categoryEffectNotifications:'Remove o histórico de sugestões proativas.',categoryEffectSources:'Remove as configurações de fontes. Esta categoria exige owner.',categoryEffectConsents:'Revoga e remove todos os consentimentos; geofences deixam de ser sincronizados.',categoryEffectDeviceProfiles:'Remove preferências de sugestões proativas de todos os aparelhos.'});
    Object.assign(I18N.en,{favoriteSaved:'Favorite place saved.',proactiveLoaded:'Suggestion opened.',eraseCategory:'Erase one category',eraseSelected:'Erase',categoryObservations:'Observations',categoryPreferences:'Preferences',categoryFavorites:'Favorite places',categoryVehicleProfiles:'Vehicle profiles',categoryActions:'Actions',categoryNotifications:'Notifications',categorySources:'Source configuration',categoryConsents:'Consent',categoryDeviceProfiles:'Device preferences',categoryEraseNote:'Only the owner can erase source configuration.',categoryEraseHelp:'Erases only the selected category after confirmation. Sources require owner; erasing favorites also disables their geofences.',categoryEraseConfirm:'Permanently erase this category?',categoryEraseIrreversible:'This action cannot be undone.',categoryEraseDone:'Category erased.',categoryEffectObservations:'Removes observations, including stored location history and recorded transitions.',categoryEffectPreferences:'Removes explicit and inferred preferences.',categoryEffectFavorites:'Removes all favorite places and disables their geofences on this device.',categoryEffectVehicleProfiles:'Removes all electric vehicle profiles.',categoryEffectActions:'Cancels active actions when possible and removes action history.',categoryEffectNotifications:'Removes proactive suggestion history.',categoryEffectSources:'Removes source configuration. This category requires owner.',categoryEffectConsents:'Revokes and removes all consent; geofences stop synchronizing.',categoryEffectDeviceProfiles:'Removes proactive suggestion preferences for every device.'});
    Object.assign(I18N.es,{favoriteSaved:'Lugar favorito guardado.',proactiveLoaded:'Sugerencia abierta.',eraseCategory:'Borrar una categoría',eraseSelected:'Borrar',categoryObservations:'Observaciones',categoryPreferences:'Preferencias',categoryFavorites:'Lugares favoritos',categoryVehicleProfiles:'Perfiles de vehículos',categoryActions:'Acciones',categoryNotifications:'Notificaciones',categorySources:'Configuración de fuentes',categoryConsents:'Consentimientos',categoryDeviceProfiles:'Preferencias de dispositivos',categoryEraseNote:'Solo el owner puede borrar la configuración de fuentes.',categoryEraseHelp:'Borra solo la categoría seleccionada después de confirmar. Fuentes exige owner; borrar favoritos también desactiva sus geofences.',categoryEraseConfirm:'¿Borrar permanentemente esta categoría?',categoryEraseIrreversible:'Esta acción no se puede deshacer.',categoryEraseDone:'Categoría borrada.',categoryEffectObservations:'Elimina observaciones, incluido el historial de ubicación y las transiciones registradas.',categoryEffectPreferences:'Elimina preferencias explícitas e inferidas.',categoryEffectFavorites:'Elimina todos los lugares favoritos y desactiva sus geofences en este dispositivo.',categoryEffectVehicleProfiles:'Elimina todos los perfiles de vehículos eléctricos.',categoryEffectActions:'Cancela acciones activas cuando es posible y elimina el historial de acciones.',categoryEffectNotifications:'Elimina el historial de sugerencias proactivas.',categoryEffectSources:'Elimina la configuración de fuentes. Esta categoría exige owner.',categoryEffectConsents:'Revoca y elimina todos los consentimientos; los geofences dejan de sincronizarse.',categoryEffectDeviceProfiles:'Elimina las preferencias de sugerencias proactivas de todos los dispositivos.'});
    Object.assign(I18N.pt,{disabledKinds:'Tipos desativados',enableKind:'Reativar',kindEnabled:'Tipo reativado neste aparelho.',notificationOpen:'Abrir/detalhes',notificationDismiss:'Dispensar',notificationDisableKind:'Desativar tipo',notificationDisableConfirm:'Desativar sugestões deste tipo neste aparelho?',notificationKind:'Tipo',proactiveNotificationLabel:'Sugestão proativa'});
    Object.assign(I18N.en,{disabledKinds:'Disabled types',enableKind:'Enable again',kindEnabled:'Type enabled again on this device.',notificationOpen:'Open/details',notificationDismiss:'Dismiss',notificationDisableKind:'Disable type',notificationDisableConfirm:'Disable suggestions of this type on this device?',notificationKind:'Type',proactiveNotificationLabel:'Proactive suggestion'});
    Object.assign(I18N.es,{disabledKinds:'Tipos desactivados',enableKind:'Reactivar',kindEnabled:'Tipo reactivado en este dispositivo.',notificationOpen:'Abrir/detalles',notificationDismiss:'Descartar',notificationDisableKind:'Desactivar tipo',notificationDisableConfirm:'¿Desactivar sugerencias de este tipo en este dispositivo?',notificationKind:'Tipo',proactiveNotificationLabel:'Sugerencia proactiva'});
    Object.assign(I18N.pt,{addToCalendar:'Adicionar à agenda',calendarDestination:'Agenda de destino',editCalendarEvent:'Editar evento',deleteCalendarEvent:'Excluir evento',editCalendarEventNote:'Revise os dados antes de gerar a prévia CalDAV.',calendarEventTitle:'Título',calendarEventStart:'Início',calendarEventEnd:'Fim',calendarEventLocation:'Local',calendarEventDescription:'Descrição',previewCalendarUpdate:'Revisar alteração',calendarEndFallback:'O evento não informou fim; a prévia usa o início mais 1 hora.',undoCalendarAction:'Desfazer',undoAvailable:'A ação pode ser desfeita por tempo limitado.',assumption:'Premissa',calendarActionUnavailable:'A ação CalDAV não está mais disponível.'});
    Object.assign(I18N.en,{addToCalendar:'Add to calendar',calendarDestination:'Destination calendar',editCalendarEvent:'Edit event',deleteCalendarEvent:'Delete event',editCalendarEventNote:'Review the data before generating the CalDAV preview.',calendarEventTitle:'Title',calendarEventStart:'Start',calendarEventEnd:'End',calendarEventLocation:'Location',calendarEventDescription:'Description',previewCalendarUpdate:'Review change',calendarEndFallback:'The event did not provide an end time; the preview uses start plus 1 hour.',undoCalendarAction:'Undo',undoAvailable:'The action can be undone for a limited time.',assumption:'Assumption',calendarActionUnavailable:'The CalDAV action is no longer available.'});
    Object.assign(I18N.es,{addToCalendar:'Agregar al calendario',calendarDestination:'Calendario de destino',editCalendarEvent:'Editar evento',deleteCalendarEvent:'Eliminar evento',editCalendarEventNote:'Revisa los datos antes de generar la vista previa CalDAV.',calendarEventTitle:'Título',calendarEventStart:'Inicio',calendarEventEnd:'Fin',calendarEventLocation:'Lugar',calendarEventDescription:'Descripción',previewCalendarUpdate:'Revisar cambio',calendarEndFallback:'El evento no informó una hora de fin; la vista previa usa el inicio más 1 hora.',undoCalendarAction:'Deshacer',undoAvailable:'La acción se puede deshacer por tiempo limitado.',assumption:'Supuesto',calendarActionUnavailable:'La acción CalDAV ya no está disponible.'});
    Object.assign(I18N.pt,{resultViewControls:'Visualização dos resultados',sourceOpenEvents:'Eventos abertos',sourceWeatherAlerts:'Alertas meteorológicos CAP',sourceLocalMcp:'MCP local',allowedResourcesPh:'agenda, eventos',allowedActionsPh:'read, navigate',sourcePurposesPh:'eventos, clima',commandArgsPh:'--config, caminho',allowedAttributesPh:'friendly_name, unit_of_measurement',serviceFieldsPh:'brightness, temperature',preferenceKeyPh:'restaurante.cozinha',preferenceValuePh:'comida mineira'});
    Object.assign(I18N.en,{resultViewControls:'Result views',sourceOpenEvents:'Open events',sourceWeatherAlerts:'CAP weather alerts',sourceLocalMcp:'Local MCP',allowedResourcesPh:'calendar, events',allowedActionsPh:'read, navigate',sourcePurposesPh:'events, weather',commandArgsPh:'--config, path',allowedAttributesPh:'friendly_name, unit_of_measurement',serviceFieldsPh:'brightness, temperature',preferenceKeyPh:'restaurant.cuisine',preferenceValuePh:'regional food'});
    Object.assign(I18N.es,{resultViewControls:'Vistas de resultados',sourceOpenEvents:'Eventos abiertos',sourceWeatherAlerts:'Alertas meteorológicas CAP',sourceLocalMcp:'MCP local',allowedResourcesPh:'calendario, eventos',allowedActionsPh:'read, navigate',sourcePurposesPh:'eventos, clima',commandArgsPh:'--config, ruta',allowedAttributesPh:'friendly_name, unit_of_measurement',serviceFieldsPh:'brightness, temperature',preferenceKeyPh:'restaurante.cocina',preferenceValuePh:'comida regional'});
    Object.assign(I18N.pt,{discoverSource:'Descobrir',sourceDiscovering:'Descobrindo capacidades...',sourceDiscovery:'Capacidades descobertas',sourceDiscoveryFailed:'Não foi possível descobrir as capacidades desta fonte.',discoveredCalendars:'Agendas',discoveredTools:'Ferramentas',discoveredResources:'Recursos',discoveryAllowed:'Permitido',discoveryAvailable:'Disponível',discoveryTruncated:'A lista foi limitada; refine a configuração da fonte.',sourceDiscoveryEmpty:'A fonte não anunciou itens.',mcpAwaitingStart:'O MCP local aguarda a aprovação da ação de inicialização; a descoberta não inicia processos.'});
    Object.assign(I18N.en,{discoverSource:'Discover',sourceDiscovering:'Discovering capabilities...',sourceDiscovery:'Discovered capabilities',sourceDiscoveryFailed:'Could not discover this source\'s capabilities.',discoveredCalendars:'Calendars',discoveredTools:'Tools',discoveredResources:'Resources',discoveryAllowed:'Allowed',discoveryAvailable:'Available',discoveryTruncated:'The list was limited; refine the source configuration.',sourceDiscoveryEmpty:'The source advertised no items.',mcpAwaitingStart:'Local MCP is awaiting approval of its start action; discovery does not start processes.'});
    Object.assign(I18N.es,{discoverSource:'Descubrir',sourceDiscovering:'Descubriendo capacidades...',sourceDiscovery:'Capacidades descubiertas',sourceDiscoveryFailed:'No fue posible descubrir las capacidades de esta fuente.',discoveredCalendars:'Calendarios',discoveredTools:'Herramientas',discoveredResources:'Recursos',discoveryAllowed:'Permitido',discoveryAvailable:'Disponible',discoveryTruncated:'La lista fue limitada; ajusta la configuración de la fuente.',sourceDiscoveryEmpty:'La fuente no anunció elementos.',mcpAwaitingStart:'El MCP local espera la aprobación de su acción de inicio; el descubrimiento no inicia procesos.'});
    Object.assign(I18N.pt,{authorizedDetails:'Detalhes (autorização separada)',calendarDetailsConsentNote:'Detalhes exigem uma autorização explícita separada; ocupado/livre continua sendo o padrão.',authorizeDetails:'Autorizar detalhes',calendarDetailsConsentTitle:'Autorizar detalhes desta agenda?',calendarDetailsConsentBody:'Títulos, locais, descrições, participantes e identificadores de eventos poderão ser consultados para as finalidades autorizadas. O acesso ocupado/livre não concede esses campos.',calendarDetailsGranted:'Acesso explícito aos detalhes autorizado.',consentFields:'Campos',calendarDetailsField:'detalhes',actionStateUncertain:'Resultado externo incerto',actionStateUncertainBody:'O destino externo pode ter recebido a ação, mas o resultado não pôde ser confirmado. Não execute novamente a mesma ação; aguarde a reconciliação ou confira o destino.',actionStateReconciliation:'Reconciliação necessária',actionStateReconciliationBody:'O estado local e o destino externo precisam ser reconciliados. A mesma chave de ação não será executada novamente; confira o destino e conclua a reconciliação.',dataCategorySummary:'Resumo dos dados por categoria',dataVolume:'Volume',dataSources:'Fontes',dataRetention:'Retenção',dataLastUpdated:'Última atualização',dataDays:'dias',dataUnknown:'Não informado',notificationIgnore:'Ignorar',feedbackOutcomeUnavailable:'Este tipo de feedback ainda não é aceito pelo servidor.'});
    Object.assign(I18N.en,{authorizedDetails:'Details (separate authorization)',calendarDetailsConsentNote:'Details require a separate explicit authorization; busy/free remains the default.',authorizeDetails:'Authorize details',calendarDetailsConsentTitle:'Authorize this calendar\'s details?',calendarDetailsConsentBody:'Event titles, locations, descriptions, participants and identifiers may be queried for the authorized purposes. Busy/free access does not grant these fields.',calendarDetailsGranted:'Explicit access to details authorized.',consentFields:'Fields',calendarDetailsField:'details',actionStateUncertain:'External result is uncertain',actionStateUncertainBody:'The external destination may have received the action, but its result could not be confirmed. Do not run the same action again; wait for reconciliation or check the destination.',actionStateReconciliation:'Reconciliation required',actionStateReconciliationBody:'Local state and the external destination must be reconciled. The same action key will not run again; check the destination and complete reconciliation.',dataCategorySummary:'Data summary by category',dataVolume:'Volume',dataSources:'Sources',dataRetention:'Retention',dataLastUpdated:'Last updated',dataDays:'days',dataUnknown:'Not reported',notificationIgnore:'Ignore',feedbackOutcomeUnavailable:'The server does not accept this feedback type yet.'});
    Object.assign(I18N.es,{authorizedDetails:'Detalles (autorización separada)',calendarDetailsConsentNote:'Los detalles requieren una autorización explícita separada; ocupado/libre sigue siendo el valor predeterminado.',authorizeDetails:'Autorizar detalles',calendarDetailsConsentTitle:'¿Autorizar los detalles de este calendario?',calendarDetailsConsentBody:'Se podrán consultar títulos, lugares, descripciones, participantes e identificadores de eventos para las finalidades autorizadas. El acceso ocupado/libre no concede estos campos.',calendarDetailsGranted:'Acceso explícito a los detalles autorizado.',consentFields:'Campos',calendarDetailsField:'detalles',actionStateUncertain:'Resultado externo incierto',actionStateUncertainBody:'El destino externo puede haber recibido la acción, pero no se pudo confirmar el resultado. No ejecutes de nuevo la misma acción; espera la reconciliación o revisa el destino.',actionStateReconciliation:'Reconciliación necesaria',actionStateReconciliationBody:'El estado local y el destino externo deben reconciliarse. La misma clave de acción no se ejecutará de nuevo; revisa el destino y completa la reconciliación.',dataCategorySummary:'Resumen de datos por categoría',dataVolume:'Volumen',dataSources:'Fuentes',dataRetention:'Retención',dataLastUpdated:'Última actualización',dataDays:'días',dataUnknown:'No informado',notificationIgnore:'Ignorar',feedbackOutcomeUnavailable:'El servidor todavía no acepta este tipo de feedback.'});
    Object.assign(I18N.pt,{preferenceInferred:'Inferida',preferenceExplicit:'Explícita',preferenceDecisionConfirmed:'Confirmada',preferenceDecisionCorrected:'Corrigida',preferenceDecisionRejected:'Rejeitada',preferenceDecisionAt:'decidida em',confirmPreference:'Confirmar',correctPreference:'Corrigir',rejectPreference:'Rejeitar',saveCorrection:'Salvar correção',correctPreferenceNote:'Revise todos os campos e salve a correção da preferência inferida.',preferenceConfirmed:'Preferência inferida confirmada.',preferenceCorrected:'Preferência inferida corrigida e salva como explícita.',preferenceRejected:'Preferência inferida rejeitada.',rejectPreferenceTitle:'Rejeitar esta preferência inferida?',rejectPreferenceBody:'Ela deixará de influenciar sugestões, mas a decisão será mantida durante a retenção configurada.',preferencePurposesRequired:'Selecione ao menos uma finalidade.',rankingDiagnostics:'Detalhes técnicos da seleção',rankingDiagnosticsCount:'descartes',diagnosticDiscarded:'descartado',weatherRiskEstimate:'Estimativa de risco climático',weatherRiskEstimateNote:'Estimativa baseada em previsão meteorológica; não é um alerta oficial.',officialWeatherAlert:'Alerta meteorológico oficial',favoriteProvenance:'Fonte'});
    Object.assign(I18N.en,{preferenceInferred:'Inferred',preferenceExplicit:'Explicit',preferenceDecisionConfirmed:'Confirmed',preferenceDecisionCorrected:'Corrected',preferenceDecisionRejected:'Rejected',preferenceDecisionAt:'decided at',confirmPreference:'Confirm',correctPreference:'Correct',rejectPreference:'Reject',saveCorrection:'Save correction',correctPreferenceNote:'Review every field and save the correction to the inferred preference.',preferenceConfirmed:'Inferred preference confirmed.',preferenceCorrected:'Inferred preference corrected and saved as explicit.',preferenceRejected:'Inferred preference rejected.',rejectPreferenceTitle:'Reject this inferred preference?',rejectPreferenceBody:'It will stop influencing suggestions, but the decision will be retained for the configured retention period.',preferencePurposesRequired:'Select at least one purpose.',rankingDiagnostics:'Technical selection details',rankingDiagnosticsCount:'discarded',diagnosticDiscarded:'discarded',weatherRiskEstimate:'Weather risk estimate',weatherRiskEstimateNote:'Estimate based on a weather forecast; it is not an official alert.',officialWeatherAlert:'Official weather alert',favoriteProvenance:'Source'});
    Object.assign(I18N.es,{preferenceInferred:'Inferida',preferenceExplicit:'Explícita',preferenceDecisionConfirmed:'Confirmada',preferenceDecisionCorrected:'Corregida',preferenceDecisionRejected:'Rechazada',preferenceDecisionAt:'decidida el',confirmPreference:'Confirmar',correctPreference:'Corregir',rejectPreference:'Rechazar',saveCorrection:'Guardar corrección',correctPreferenceNote:'Revisa todos los campos y guarda la corrección de la preferencia inferida.',preferenceConfirmed:'Preferencia inferida confirmada.',preferenceCorrected:'Preferencia inferida corregida y guardada como explícita.',preferenceRejected:'Preferencia inferida rechazada.',rejectPreferenceTitle:'¿Rechazar esta preferencia inferida?',rejectPreferenceBody:'Dejará de influir en las sugerencias, pero la decisión se conservará durante el periodo de retención configurado.',preferencePurposesRequired:'Selecciona al menos una finalidad.',rankingDiagnostics:'Detalles técnicos de la selección',rankingDiagnosticsCount:'descartes',diagnosticDiscarded:'descartado',weatherRiskEstimate:'Estimación de riesgo meteorológico',weatherRiskEstimateNote:'Estimación basada en un pronóstico meteorológico; no es una alerta oficial.',officialWeatherAlert:'Alerta meteorológica oficial',favoriteProvenance:'Fuente'});
    Object.assign(I18N.pt,{notificationIgnored:'Sugestão ignorada.',notificationDismissed:'Sugestão dispensada.',notificationKindDisabled:'Tipo desativado neste aparelho.'});
    Object.assign(I18N.en,{notificationIgnored:'Suggestion ignored.',notificationDismissed:'Suggestion dismissed.',notificationKindDisabled:'Type disabled on this device.'});
    Object.assign(I18N.es,{notificationIgnored:'Sugerencia ignorada.',notificationDismissed:'Sugerencia descartada.',notificationKindDisabled:'Tipo desactivado en este dispositivo.'});
    Object.assign(I18N.pt,{proactiveDevicePolicy:'Estes limites pertencem somente a este aparelho; na ausência de override, o perfil usa a política geral.',proactiveDevicePolicyOverride:'Este aparelho usa limites próprios. Alterações aqui não afetam outros aparelhos.',proactiveDevicePolicyFallback:'Este aparelho ainda usa a política geral. Salvar cria limites próprios somente para ele.',invalidDeviceNotificationPolicy:'Revise os horários e limites de notificação deste aparelho.'});
    Object.assign(I18N.en,{proactiveDevicePolicy:'These limits belong only to this device; without an override, the profile uses the general policy.',proactiveDevicePolicyOverride:'This device uses its own limits. Changes here do not affect other devices.',proactiveDevicePolicyFallback:'This device still uses the general policy. Saving creates limits only for this device.',invalidDeviceNotificationPolicy:'Review this device notification times and limits.'});
    Object.assign(I18N.es,{proactiveDevicePolicy:'Estos límites pertenecen solo a este dispositivo; sin un override, el perfil usa la política general.',proactiveDevicePolicyOverride:'Este dispositivo usa límites propios. Los cambios aquí no afectan a otros dispositivos.',proactiveDevicePolicyFallback:'Este dispositivo todavía usa la política general. Guardar crea límites solo para este dispositivo.',invalidDeviceNotificationPolicy:'Revisa los horarios y límites de notificación de este dispositivo.'});
    I18N.pt.proactiveUnavailable='Abra o assistente para consultar dados atualizados e a procedência.';
    I18N.en.proactiveUnavailable='Open the assistant to query updated data and provenance.';
    I18N.es.proactiveUnavailable='Abre el asistente para consultar datos actualizados y su procedencia.';
    Object.assign(I18N.pt,{referencePoint:'Ponto de referência',referenceAutomatic:'Usar localização disponível',referenceRegion:'Informar região',regionOrAddress:'Região ou endereço',regionOrAddressPh:'Ex.: Savassi, Belo Horizonte',findRegion:'Localizar região',referenceFallback:'Se a localização atual não estiver disponível, escolha um favorito ou informe uma região.',referenceFavoriteActive:'A consulta usará o favorito selecionado no lugar da localização atual.',referenceRegionActive:'Informe e localize uma região para esta consulta.',regionResults:'Regiões encontradas',favoriteReferences:'Locais favoritos',chooseRegion:'Usar esta região',regionResolved:'Região selecionada',noRegions:'Nenhuma região encontrada nas fontes autorizadas.'});
    Object.assign(I18N.en,{referencePoint:'Reference point',referenceAutomatic:'Use available location',referenceRegion:'Enter a region',regionOrAddress:'Region or address',regionOrAddressPh:'Example: Downtown, Belo Horizonte',findRegion:'Find region',referenceFallback:'If current location is unavailable, choose a favorite or enter a region.',referenceFavoriteActive:'The query will use the selected favorite instead of current location.',referenceRegionActive:'Enter and resolve a region for this query.',regionResults:'Regions found',favoriteReferences:'Favorite places',chooseRegion:'Use this region',regionResolved:'Region selected',noRegions:'No region found in authorized sources.'});
    Object.assign(I18N.es,{referencePoint:'Punto de referencia',referenceAutomatic:'Usar ubicación disponible',referenceRegion:'Indicar región',regionOrAddress:'Región o dirección',regionOrAddressPh:'Ej.: Savassi, Belo Horizonte',findRegion:'Localizar región',referenceFallback:'Si la ubicación actual no está disponible, elige un favorito o indica una región.',referenceFavoriteActive:'La consulta usará el favorito seleccionado en lugar de la ubicación actual.',referenceRegionActive:'Indica y localiza una región para esta consulta.',regionResults:'Regiones encontradas',favoriteReferences:'Lugares favoritos',chooseRegion:'Usar esta región',regionResolved:'Región seleccionada',noRegions:'No se encontró ninguna región en las fuentes autorizadas.'});
    Object.assign(I18N.pt,{mcpOutputSchema:'Schema de saída MCP (JSON)',mcpOutputSchemaPh:'{"type":"object","properties":{},"additionalProperties":false}',mcpOutputSchemaNote:'Objeto JSON fechado usado para validar o resultado de cada tool permitida.',stdioEnvironment:'Ambiente do processo stdio',environmentName:'Variável',environmentValue:'Novo valor',addEnvironment:'Adicionar',stdioEnvironmentNote:'Valores salvos não são exibidos. Variáveis sensíveis devem usar a variável de segredo acima.',envValueHidden:'valor oculto',envValuePending:'novo valor definido',removeEnvironment:'Remover variável',invalidEnvName:'Use um nome de variável de ambiente válido.',sensitiveEnvRejected:'Variáveis sensíveis devem usar a variável de segredo, não o ambiente comum.',envValueRequired:'Informe o novo valor da variável.',outputSchemaRequired:'Informe um outputSchema JSON para as tools MCP permitidas.',outputSchemaInvalid:'O outputSchema deve ser um JSON válido.',outputSchemaObject:'O outputSchema deve ser um objeto JSON.',outputSchemaClosed:'O outputSchema deve ser um objeto fechado, com properties e additionalProperties igual a false.',sourceConfigTooLarge:'A configuração da fonte excede o limite permitido.'});
    Object.assign(I18N.en,{mcpOutputSchema:'MCP output schema (JSON)',mcpOutputSchemaPh:'{"type":"object","properties":{},"additionalProperties":false}',mcpOutputSchemaNote:'Closed JSON object used to validate the result of every allowed tool.',stdioEnvironment:'Stdio process environment',environmentName:'Variable',environmentValue:'New value',addEnvironment:'Add',stdioEnvironmentNote:'Saved values are not displayed. Sensitive variables must use the secret variable above.',envValueHidden:'value hidden',envValuePending:'new value set',removeEnvironment:'Remove variable',invalidEnvName:'Use a valid environment variable name.',sensitiveEnvRejected:'Sensitive variables must use the secret variable, not the regular environment.',envValueRequired:'Enter the variable\'s new value.',outputSchemaRequired:'Provide a JSON outputSchema for the allowed MCP tools.',outputSchemaInvalid:'The outputSchema must be valid JSON.',outputSchemaObject:'The outputSchema must be a JSON object.',outputSchemaClosed:'The outputSchema must be a closed object with properties and additionalProperties set to false.',sourceConfigTooLarge:'The source configuration exceeds the allowed limit.'});
    Object.assign(I18N.es,{mcpOutputSchema:'Schema de salida MCP (JSON)',mcpOutputSchemaPh:'{"type":"object","properties":{},"additionalProperties":false}',mcpOutputSchemaNote:'Objeto JSON cerrado usado para validar el resultado de cada tool permitida.',stdioEnvironment:'Entorno del proceso stdio',environmentName:'Variable',environmentValue:'Nuevo valor',addEnvironment:'Agregar',stdioEnvironmentNote:'Los valores guardados no se muestran. Las variables sensibles deben usar la variable de secreto anterior.',envValueHidden:'valor oculto',envValuePending:'nuevo valor definido',removeEnvironment:'Eliminar variable',invalidEnvName:'Usa un nombre de variable de entorno válido.',sensitiveEnvRejected:'Las variables sensibles deben usar la variable de secreto, no el entorno común.',envValueRequired:'Indica el nuevo valor de la variable.',outputSchemaRequired:'Indica un outputSchema JSON para las tools MCP permitidas.',outputSchemaInvalid:'El outputSchema debe ser JSON válido.',outputSchemaObject:'El outputSchema debe ser un objeto JSON.',outputSchemaClosed:'El outputSchema debe ser un objeto cerrado, con properties y additionalProperties igual a false.',sourceConfigTooLarge:'La configuración de la fuente supera el límite permitido.'});
    Object.assign(I18N.pt,{findAddress:'Buscar endereço',addressResults:'Endereços encontrados',resolvedCoordinates:'Coordenadas resolvidas',coordinatesFallback:'Use somente quando a busca de endereço ou a localização do aparelho não estiver disponível.',chooseAddress:'Usar este endereço',addressResolved:'Endereço selecionado',noAddresses:'Nenhum endereço encontrado nas fontes autorizadas.',saveAsFavorite:'Salvar local',favoriteNamePrompt:'Nome deste local',favoriteFromResultSaved:'Local salvo nos favoritos.'});
    Object.assign(I18N.en,{findAddress:'Find address',addressResults:'Addresses found',resolvedCoordinates:'Resolved coordinates',coordinatesFallback:'Use only when address search or device location is unavailable.',chooseAddress:'Use this address',addressResolved:'Address selected',noAddresses:'No address found in authorized sources.',saveAsFavorite:'Save place',favoriteNamePrompt:'Name this place',favoriteFromResultSaved:'Place saved to favorites.'});
    Object.assign(I18N.es,{findAddress:'Buscar dirección',addressResults:'Direcciones encontradas',resolvedCoordinates:'Coordenadas resueltas',coordinatesFallback:'Úsalas solo cuando la búsqueda de dirección o la ubicación del dispositivo no estén disponibles.',chooseAddress:'Usar esta dirección',addressResolved:'Dirección seleccionada',noAddresses:'No se encontró ninguna dirección en las fuentes autorizadas.',saveAsFavorite:'Guardar lugar',favoriteNamePrompt:'Nombre de este lugar',favoriteFromResultSaved:'Lugar guardado en favoritos.'});
    Object.assign(I18N.pt,{memorySource:'Fonte',memoryEvidence:'Evidência',memoryScope:'Escopo',memoryConfidence:'Confiança',memoryValidity:'Validade',memoryLastUsed:'Último uso',memoryNoExpiry:'Sem expiração',memoryNeverUsed:'Não informado',memoryEvidenceUnknown:'Sem evidência detalhada',forget:'Esquecer',forgetPreferenceTitle:'Esquecer esta memória?',forgetPreferenceBody:'Ela deixará de influenciar as sugestões imediatamente.',memoryForgotten:'Memória esquecida.',dislike:'Não gostei',feedbackLiked:'Feedback “Gostei” registrado.',feedbackDisliked:'Feedback “Não gostei” registrado.',feedbackAvoided:'Este resultado não será sugerido como preferência explícita.',feedbackRemembered:'Preferência lembrada.',memoryValidUntil:'Válida até (opcional)',memoryExpiryFuture:'A validade deve estar no futuro.'});
    Object.assign(I18N.en,{memorySource:'Source',memoryEvidence:'Evidence',memoryScope:'Scope',memoryConfidence:'Confidence',memoryValidity:'Validity',memoryLastUsed:'Last used',memoryNoExpiry:'No expiration',memoryNeverUsed:'Not reported',memoryEvidenceUnknown:'No detailed evidence',forget:'Forget',forgetPreferenceTitle:'Forget this memory?',forgetPreferenceBody:'It will stop influencing suggestions immediately.',memoryForgotten:'Memory forgotten.',dislike:'Dislike',feedbackLiked:'“Like” feedback recorded.',feedbackDisliked:'“Dislike” feedback recorded.',feedbackAvoided:'This result will not be suggested as an explicit preference.',feedbackRemembered:'Preference remembered.',memoryValidUntil:'Valid until (optional)',memoryExpiryFuture:'Validity must be in the future.'});
    Object.assign(I18N.es,{memorySource:'Fuente',memoryEvidence:'Evidencia',memoryScope:'Alcance',memoryConfidence:'Confianza',memoryValidity:'Validez',memoryLastUsed:'Último uso',memoryNoExpiry:'Sin vencimiento',memoryNeverUsed:'No informado',memoryEvidenceUnknown:'Sin evidencia detallada',forget:'Olvidar',forgetPreferenceTitle:'¿Olvidar esta memoria?',forgetPreferenceBody:'Dejará de influir en las sugerencias inmediatamente.',memoryForgotten:'Memoria olvidada.',dislike:'No me gusta',feedbackLiked:'Feedback “Me gusta” registrado.',feedbackDisliked:'Feedback “No me gusta” registrado.',feedbackAvoided:'Este resultado no se sugerirá como preferencia explícita.',feedbackRemembered:'Preferencia recordada.',memoryValidUntil:'Válida hasta (opcional)',memoryExpiryFuture:'La validez debe estar en el futuro.'});
    Object.assign(I18N.pt,{openingNavigation:'Abrindo navegação…',popupBlocked:'O navegador bloqueou a nova janela. Permita popups para o Jarvis e tente novamente.',navigationOpenFailed:'Não foi possível abrir o destino de navegação.',navigationAckInvalid:'O Hub não confirmou corretamente o handoff de navegação.',navigationOpened:'Abertura da navegação confirmada.',actionStateFailed:'A ação falhou.',actionAwaitingClientAck:'Aguardando confirmação do navegador.',actionClientAckDeadline:'Prazo de confirmação:',actionClientAckChecking:'O prazo de confirmação terminou. Verificando o estado no Hub.',actionClientAckUnavailable:'O Hub não retornou o estado final após o prazo.',navigationAckExpired:'A confirmação da abertura não chegou dentro do prazo.'});
    Object.assign(I18N.en,{openingNavigation:'Opening directions…',popupBlocked:'The browser blocked the new window. Allow popups for Jarvis and try again.',navigationOpenFailed:'The navigation destination could not be opened.',navigationAckInvalid:'The Hub did not correctly confirm the navigation handoff.',navigationOpened:'Navigation handoff confirmed.',actionStateFailed:'The action failed.',actionAwaitingClientAck:'Waiting for browser confirmation.',actionClientAckDeadline:'Confirmation deadline:',actionClientAckChecking:'The confirmation deadline passed. Checking the state with the Hub.',actionClientAckUnavailable:'The Hub did not return a final state after the deadline.',navigationAckExpired:'Confirmation that directions opened did not arrive before the deadline.'});
    Object.assign(I18N.es,{openingNavigation:'Abriendo navegación…',popupBlocked:'El navegador bloqueó la nueva ventana. Permite popups para Jarvis e inténtalo de nuevo.',navigationOpenFailed:'No se pudo abrir el destino de navegación.',navigationAckInvalid:'El Hub no confirmó correctamente el handoff de navegación.',navigationOpened:'Apertura de navegación confirmada.',actionStateFailed:'La acción falló.',actionAwaitingClientAck:'Esperando la confirmación del navegador.',actionClientAckDeadline:'Plazo de confirmación:',actionClientAckChecking:'El plazo de confirmación terminó. Verificando el estado con el Hub.',actionClientAckUnavailable:'El Hub no devolvió un estado final después del plazo.',navigationAckExpired:'La confirmación de apertura de la ruta no llegó dentro del plazo.'});
    let lang = cfg.lang || (navigator.language||'pt').slice(0,2); if(!I18N[lang]) lang='pt';
    const t = k => (I18N[lang]&&I18N[lang][k]) || I18N.pt[k] || k;
    Object.assign(I18N.pt,{hAi:'Agrupa agente, modelo e esforço da IA para a próxima mensagem.'});
    Object.assign(I18N.en,{hAi:'Groups AI agent, model and effort for the next message.'});
    Object.assign(I18N.es,{hAi:'Agrupa IA, modelo y esfuerzo para el próximo mensaje.'});
    const HELP_TARGETS={newSess:'hNewSess',settingsBtn:'hSettings',searchBtn:'hSearch',digestBtn:'hDigest',workBtn:'hWork',personalBtn:'hPersonal',termMenuBtn:'hTerminal',usageBtn:'hUsage',qrUrl:'hMobile',secDevices:'hDevices',updCheck:'hUpdate',sumHdr:'hSummary',termBtn:'hTerminal',treeBtn:'hFiles',optsBtn:'hOptions',attach:'hAttach',designBtn:'hDesign',solutionBtn:'hSolutions',settingsHelpBtn:'settingsHelpBtnTitle',aiBtn:'hAi',agentBtn:'hAgent',cwdBtn:'hCwd',modelBtn:'hModel',effortBtn:'hEffort',speak:'hSpeak',stopBtn:'hStop',sendBtn:'hSend',setLang:'hLang',setAgent:'hDefaultAgent',setModel:'hDefaultModel',setEffort:'hDefaultEffort',setSlash:'hSlash',setVoiceAgent:'hVoiceAgent',setVoiceModel:'hVoiceAgent',setVoiceEffort:'hVoiceAgent',voiceCatalog:'hVoiceTimbre',setVoice:'hSpeak',setContinue:'lblContinue',setWake:'hWakeLocked',setNoise:'hNoise',setGate:'hVoiceGate',setPush:'hNotifPlatforms',setBioLock:'hBio',routinesSection:'hRoutineUse',rtCron:'hRoutineUse',rtAdd:'hRoutineUse',setPolicyMode:'hPolicy',setPolicyPersonalContext:'hPolicyPersonalContext',policySettings:'hPolicy',frameworkSettings:'hFramework'};
    const HELP_ICON_IDS=new Set();
    const SETTINGS_PANEL_HELP={
      geral:{title:'settingsHelpGeneralTitle',body:'hGeneral',items:['language','hDefaultAgent','hDefaultModel','hDefaultEffort','hSlash']},
      assistente:{title:'settingsHelpAssistantTitle',body:'hAssistantPanel',items:['locationPrivacy','actionPolicy']},
      fontes:{title:'settingsHelpSourcesTitle',body:'hSourcesPanel',items:['sourcesDesc']},
      dados:{title:'settingsHelpDataTitle',body:'hDataPanel',items:['vehicleHelp','retention','categoryEraseHelp']},
      voz:{title:'settingsHelpVoiceTitle',body:'hVoicePanel',items:['hSpeak','hVoiceAgent','hVoiceTimbre','hWakeLocked','hNoise','hVoiceGate']},
      notif:{title:'settingsHelpNotifTitle',body:'hNotifPanel',items:['hNotifPlatforms','hPushDelivery','hBio','hGeo']},
      automacao:{title:'settingsHelpAutomationTitle',body:'hAutomationPanel',items:['hRoutineUse','hPolicy','hPolicyPersonalContext','hStopQueue']},
      framework:{title:'settingsHelpFrameworkTitle',body:'hFrameworkPanel',items:['hFramework']},
      rota:{title:'settingsHelpRouteTitle',body:'descAutoRoute',items:['hAgent','hModel','hEffort']},
      uso:{title:'settingsHelpUsageTitle',body:'hUsagePanel',items:['hUsage']},
      celular:{title:'settingsHelpMobileTitle',body:'hMobilePanel',items:['hMobile']},
      dispositivos:{title:'settingsHelpDeviceTitle',body:'hDevicePanel',items:['hDevices']},
      update:{title:'settingsHelpUpdateTitle',body:'hUpdatePanel',items:['hUpdate']},
    };
    function helpElement(id){ const el=document.getElementById(id); if(!el)return null; return /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)?(el.closest('label')||el):el; }
    function helpDialog(titleKey,bodyKey,items){
      const L=[t(titleKey),'',t('helpWhat'),t(bodyKey)];
      if(items&&items.length){ L.push('',t('helpOptions')); items.forEach(k=>L.push('- '+t(k))); }
      return dialog({title:L.join('\n'),okText:t('closeHelp'),cancelText:null});
    }
    function settingsCurrentPanel(){ const on=E.settings&&E.settings.querySelector('.snav.on'); return (on&&on.dataset.goto)||'geral'; }
    function updateSettingsHelpButton(name){ if(!E.settingsHelpBtn)return; const info=SETTINGS_PANEL_HELP[name]||SETTINGS_PANEL_HELP.geral, title=t('settingsHelpBtnTitle')+': '+t(info.title); E.settingsHelpBtn.title=title; E.settingsHelpBtn.setAttribute('aria-label',title); }
    function openSettingsHelp(name){ const panel=name||settingsCurrentPanel(); const info=SETTINGS_PANEL_HELP[panel]||SETTINGS_PANEL_HELP.geral;
      const keys=PANEL_HELP_SECTIONS[panel];
      if(keys&&keys.length&&openHelpSheet(keys,t(info.title),PANEL_HELP_ICON[panel]||'')) return;
      helpDialog(info.title,info.body,info.items); }
    function helpEsc(s){ return String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
    const HELP_SECTION_META={assistant:{icon:'🤖',accent:'#2dd4bf'},location:{icon:'📍',accent:'#4f83ff'},proactive:{icon:'🔔',accent:'#a78bfa'},actionPolicy:{icon:'⚡',accent:'#f5b544'},
      sources:{icon:'🧩',accent:'#38bdf8'},consents:{icon:'✅',accent:'#34d399'},configureSource:{icon:'🛠️',accent:'#94a3b8'},
      personalData:{icon:'🗂️',accent:'#4f83ff'},favorites:{icon:'⭐',accent:'#f5b544'},vehicles:{icon:'🚗',accent:'#2dd4bf'},preferences:{icon:'🎛️',accent:'#a78bfa'},retention:{icon:'🛡️',accent:'#f87171'},
      geral:{icon:'⚙️',accent:'#94a3b8'},voz:{icon:'🎙️',accent:'#f472b6'},notif:{icon:'🔔',accent:'#f5b544'},automacao:{icon:'⏱️',accent:'#a78bfa'},framework:{icon:'🧱',accent:'#38bdf8'},rota:{icon:'🧭',accent:'#4f83ff'},uso:{icon:'📊',accent:'#34d399'},celular:{icon:'📱',accent:'#2dd4bf'},dispositivos:{icon:'🔐',accent:'#f87171'},update:{icon:'⬆️',accent:'#4f83ff'},solutions:{icon:'🧠',accent:'#a78bfa'}};
    const PANEL_HELP_SECTIONS={assistente:['assistant','location','proactive','actionPolicy'],fontes:['sources','consents','configureSource'],dados:['personalData','favorites','vehicles','preferences','retention'],
      geral:['geral'],voz:['voz'],notif:['notif'],automacao:['automacao'],framework:['framework'],rota:['rota'],uso:['uso'],celular:['celular'],dispositivos:['dispositivos'],update:['update']};
    const PANEL_HELP_ICON={assistente:'🤖',fontes:'🧩',dados:'🗂️',geral:'⚙️',voz:'🎙️',notif:'🔔',automacao:'⏱️',framework:'🧱',rota:'🧭',uso:'📊',celular:'📱',dispositivos:'🔐',update:'⬆️'};
    function helpFacet(cls,icon,label,text){ if(!text) return ''; return `<div class="hfacet ${cls}"><span class="hfacet-ic">${icon}</span><div class="hfacet-c"><span class="hfacet-l">${helpEsc(label)}</span><span class="hfacet-t">${helpEsc(text)}</span></div></div>`; }
    function renderHelpSheet(keys,headerTitle,headerIcon){ const pack=PERSONAL_HELP[lang]||PERSONAL_HELP.pt;
      const list=(Array.isArray(keys)?keys:[keys]).map(k=>({k,info:pack&&pack[k]})).filter(x=>x.info);
      if(!list.length||!E.helpSheetBody) return false;
      const first=HELP_SECTION_META[list[0].k]||{icon:'📘',accent:'#4f83ff'};
      const title=headerTitle||list[0].info.title, hIcon=headerIcon||first.icon, multi=list.length>1;
      if(E.helpSheetTitle) E.helpSheetTitle.innerHTML=`<span class="help-title-ic">${hIcon}</span>${helpEsc(title)}`;
      E.helpSheetBody.style.setProperty('--acc',first.accent);
      const wl=t('helpWhat'),ul=t('helpUseLabel'),dl=t('helpDataLabel'),el=t('helpExampleLabel');
      let html='';
      list.forEach(({k,info})=>{ const meta=HELP_SECTION_META[k]||{icon:'📘',accent:'#4f83ff'};
        html+=`<section class="help-group" style="--acc:${meta.accent}">`;
        if(multi) html+=`<div class="help-group-h"><span class="help-group-ic">${meta.icon}</span>${helpEsc(info.title)}</div>`;
        if(info.how) html+=`<div class="help-hero"><span class="help-hero-ic">${meta.icon}</span><p>${helpEsc(info.how)}</p></div>`;
        (info.fields||[]).forEach(f=>{ html+=`<article class="help-field"><div class="help-field-h"><span class="help-field-ic">${meta.icon}</span><h4>${helpEsc(f.name)}</h4></div><div class="help-facets">`+
          helpFacet('what','💡',wl,f.what)+helpFacet('use','🎯',ul,f.use)+helpFacet('data','🔒',dl,f.data)+helpFacet('ex','💬',el,f.example)+
          `</div></article>`; });
        html+=`</section>`; });
      E.helpSheetBody.innerHTML=html; if(E.helpSheetBody.scrollTop) E.helpSheetBody.scrollTop=0; return true; }
    function openHelpSheet(keys,title,icon){ if(!E.helpSheet||!renderHelpSheet(keys,title,icon)) return false; E.helpSheet.classList.remove('hidden'); if(E.helpSheetClose) setTimeout(()=>E.helpSheetClose.focus(),20); return true; }
    function closeHelpSheet(){ if(E.helpSheet) E.helpSheet.classList.add('hidden'); }
    function openSolutionHelp(){
      if(openHelpSheet(['solutions'], t('helpSolutionsTitle'), '🧠')) return;
      helpDialog('helpSolutionsTitle',SOLUTION_HELP[solutionArm().mode]||'hSolutionsUse',['hSolutionsUse']);
    }
    function installHelp(){ Object.entries(HELP_TARGETS).forEach(([id,key])=>{ const el=helpElement(id); if(!el)return; el.classList.toggle('helpable',HELP_ICON_IDS.has(id)); el.title=t(key); if(id==='sendBtn'){ el.setAttribute('aria-label',t('sendTitle')); el.title=t('sendTitle'); } });
      const panelHelp={geral:'hGeneral',voz:'hVoicePanel',notif:'hNotifPanel',automacao:'hAutomationPanel',framework:'hFrameworkPanel',rota:'descAutoRoute',uso:'hUsagePanel',celular:'hMobilePanel',dispositivos:'hDevicePanel',update:'hUpdatePanel'};
      document.querySelectorAll('.snav[data-goto]').forEach(el=>{ const key=panelHelp[el.dataset.goto]; if(key){ el.classList.remove('helpable'); el.title=t(key); } });
      updateSettingsHelpButton(settingsCurrentPanel());
    }
    function applyI18n(){ document.querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent=t(el.dataset.i18n); }); document.querySelectorAll('[data-i18n-ph]').forEach(el=>{ el.placeholder=t(el.dataset.i18nPh); }); document.querySelectorAll('[data-i18n-title]').forEach(el=>{ el.title=t(el.dataset.i18nTitle); }); document.querySelectorAll('[data-i18n-aria]').forEach(el=>{ el.setAttribute('aria-label',t(el.dataset.i18nAria)); }); installHelp(); }
    function setLang(l){ if(!I18N[l])return; lang=l; cfg.lang=l; saveCfg(); applyI18n(); if(typeof refreshComposer==='function') refreshComposer(); if(typeof renderVoiceCatalog==='function') renderVoiceCatalog(); if(typeof personalSourceTypeUi==='function')personalSourceTypeUi(); if(typeof renderPersonalSourceEnvironment==='function')renderPersonalSourceEnvironment(); if(typeof renderPersonalState==='function'&&personalState)renderPersonalState(); if(typeof renderPersonalTurnSuggestionForCurrent==='function')renderPersonalTurnSuggestionForCurrent(true); }
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
      const head=cells(rows[0]),body=rows.slice(2).map(cells);
      return `<div class="mdtable-wrap"><div class="mdtable-actions"><button type="button" class="ghost mdtable-copy" title="Copiar tabela como texto">Copiar</button><button type="button" class="ghost mdtable-png" title="Baixar tabela como PNG">PNG</button></div><table><thead><tr>${head.map(c=>`<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
    function tableText(table){ return [...table.querySelectorAll('tr')].map(tr=>[...tr.children].map(td=>(td.textContent||'').replace(/\s+/g,' ').trim()).join('\t')).join('\n'); }
    function tableDownloadName(){ const d=new Date(), pad=n=>String(n).padStart(2,'0'); return `jarvis-tabela-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.png`; }
    async function exportTablePng(table, btn){
      if(!table)return;
      const old=btn&&btn.textContent; if(btn){ btn.disabled=true; btn.textContent='gerando'; }
      try{
        const clone=table.cloneNode(true);
        clone.querySelectorAll('a').forEach(a=>{ const s=document.createElement('span'); s.textContent=a.textContent||a.href||''; a.replaceWith(s); });
        const w=Math.ceil(Math.max(table.scrollWidth, table.getBoundingClientRect().width, 320));
        const h=Math.ceil(Math.max(table.scrollHeight, table.getBoundingClientRect().height, 80));
        const css='table{border-collapse:collapse;width:max-content;min-width:max-content;background:#151b21;color:#e6e9ec;font:14px system-ui,-apple-system,Segoe UI,sans-serif}th,td{border:1px solid #34404c;padding:7px 11px;text-align:left;vertical-align:top;min-width:120px;max-width:380px;word-break:normal;overflow-wrap:normal}th{background:#252c34;font-weight:700}code{background:#ffffff1a;border-radius:5px;padding:1px 5px;font:13px ui-monospace,Consolas,monospace;white-space:nowrap}';
        const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>${css}</style>${clone.outerHTML}</div></foreignObject></svg>`;
        const img=new Image(), url='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
        await new Promise((res,rej)=>{ img.onload=res; img.onerror=rej; img.src=url; });
        const scale=Math.min(2,Math.max(1,window.devicePixelRatio||1)), canvas=document.createElement('canvas');
        canvas.width=Math.ceil(w*scale); canvas.height=Math.ceil(h*scale);
        const ctx=canvas.getContext('2d'); ctx.scale(scale,scale); ctx.fillStyle='#151b21'; ctx.fillRect(0,0,w,h); ctx.drawImage(img,0,0);
        const a=document.createElement('a'); a.download=tableDownloadName(); a.href=canvas.toDataURL('image/png'); a.click();
        if(btn){ btn.textContent='baixado'; setTimeout(()=>btn.textContent=old,1200); }
      }catch(e){ toast('Não foi possível exportar a tabela como PNG.'); if(btn)btn.textContent=old; }
      finally{ if(btn)btn.disabled=false; }
    }
    function md(text){ const codes=[]; text=text.replace(/```(\w*)\n?([\s\S]*?)```/g,(_,l,c)=>{codes.push(c);return ` C${codes.length-1} `;});
      const L=text.split(/\r?\n/); let h='',i=0,m; while(i<L.length){ const line=L[i];
        if(m=line.match(/^ C(\d+) $/)){ h+=`<div class="codewrap"><button type="button" class="copy ghost">copiar</button><pre><code>${esc(codes[+m[1]])}</code></pre></div>`; i++; continue; }
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
    function fileBaseName(path){ return String(path||'').split(/[\\/]/).pop()||String(path||'arquivo'); }
    function normPathKey(path){ return String(path||'').replace(/\\/g,'/').trim().toLowerCase(); }
    function isFileToolName(name){ return /Edit$/.test(name||'')||name==='Write'||name==='Read'||name==='NotebookEdit'; }
    function isMutableFileTool(name){ return /Edit$/.test(name||'')||name==='Write'||name==='NotebookEdit'; }
    function isGenericThinking(text){ return /^(pensando|thinking)\s*[.….]?$/i.test(String(text||'Pensando').trim()||'Pensando'); }
    function fileGroupKey(ev){ return ev&&ev.path&&isMutableFileTool(ev.name)?'file\0'+(ev.parentId||'root')+'\0'+normPathKey(ev.path):''; }
    function sameFileGroup(a,b){ return fileGroupKey(a)&&fileGroupKey(a)===fileGroupKey(b); }
    function isRepeatableTool(name){
      const n=String(name||'').trim();
      return !!n && !isFileToolName(n) && !['Task','Agent','Thinking','Plan','InputRequired'].includes(n);
    }
    function compactToolText(ev){ return String((ev&&ev.summary)||'').replace(/\s+/g,' ').trim(); }
    function repeatToolKey(ev){ const txt=compactToolText(ev); return ev&&isRepeatableTool(ev.name)&&txt?'repeat\0'+(ev.parentId||'root')+'\0'+ev.name+'\0'+txt.toLowerCase():''; }
    function sameRepeatGroup(a,b){ return repeatToolKey(a)&&repeatToolKey(a)===repeatToolKey(b); }
    function toolOpts(opts,item){ return item&&item.background?Object.assign({},opts||{},{background:true}):opts; }
    function addToolBadges(head,background){ if(background){ const b=document.createElement('span'); b.className='tbadge'; b.textContent='background'; b.title='Comando iniciado em segundo plano pelo provider'; head.appendChild(b); } }
    function activityHasContent(m){
      if(!m)return false;
      return !!(String(m.name||'').trim()||String(m.summary||'').trim()||String(m.path||'').trim()||String(m.detail||'').trim()||(Array.isArray(m.rows)&&m.rows.length));
    }
    function markLooseActivityEl(el){ if(el)el.classList.add('act'); return el; }
    function trackLooseActivityEl(el){ if(!el)return el; markLooseActivityEl(el); if(!looseActivityEls.includes(el))looseActivityEls.push(el); return el; }
    function clearLooseActivity(){
      const seen=new Set();
      Object.values(looseActivityGroups||{}).forEach(el=>{ if(el&&!seen.has(el)){ seen.add(el); el.remove(); } });
      (looseActivityEls||[]).forEach(el=>{ if(el&&!seen.has(el)){ seen.add(el); el.remove(); } });
      looseActivityGroups={}; looseActivityEls=[]; looseLastGroupKey='';
    }
    function fileGroupTitle(items,done){
      const list=items||[], first=list[0]||{}, base=fileBaseName(first.path), n=list.length;
      const verb=done?(first.name==='Write'&&n===1?'Criado':'Editado'):(first.name==='Write'&&n===1?'Criando':'Editando');
      return `${verb} ${base}${n>1?' · '+n+' alterações':''}`;
    }
    function sumCounts(items){ return (items||[]).reduce((a,x)=>({adds:a.adds+(x.adds||0),dels:a.dels+(x.dels||0)}),{adds:0,dels:0}); }
    function renderGroupBody(group,opts){
      const body=group.querySelector('.tgbody'); if(!body)return; body.innerHTML='';
      (group._items||[]).forEach((it,i)=>{
        const row=document.createElement('div'); row.className='tgitem';
        const title=document.createElement('span'); title.className='tgtitle'; title.textContent=(i+1)+'. '+pastify(it.name,it.summary||it.name||fileBaseName(it.path)); row.appendChild(title);
        if(it.adds||it.dels){ const c=document.createElement('span'); c.className='tcnt'; c.innerHTML=`<span class="fadd">+${it.adds||0}</span> <span class="fdel">-${it.dels||0}</span>`;
          if(it.rows&&it.rows.length){ c.classList.add('clk'); c.title='Ver o diff desta alteração'; c.onclick=(e)=>{ e.stopPropagation(); toggleInlineDiff(row,it.rows,it.adds,it.dels); }; }
          row.appendChild(c); }
        if(it.detail){ row.title='Detalhe disponível no resumo expandido'; }
        body.appendChild(row);
      });
    }
    function refreshToolGroup(group,done,opts){
      const items=group._items||[], first=items[0]||{}, title=fileGroupTitle(items,done);
      group.dataset.sum=title; group.dataset.name=first.name||'Edit';
      const ttl=group.querySelector('.ttl'); if(ttl) ttl.textContent=title;
      const multi=items.length>1, btn=group.querySelector('.xpand'), body=group.querySelector('.tgbody');
      group.classList.toggle('single',!multi);
      if(btn){ btn.classList.toggle('hidden',!multi); btn.disabled=!multi; if(!multi){ btn.textContent='▸'; btn.title=''; } }
      if(!multi){ group.classList.remove('expanded'); if(body){ body.classList.add('hidden'); body.innerHTML=''; } }
      const c=sumCounts(items), cnt=group.querySelector('.tcnt.total');
      if(cnt){
        cnt.innerHTML=`<span class="fadd">+${c.adds||0}</span> <span class="fdel">-${c.dels||0}</span>`;
        cnt.classList.remove('clk'); cnt.title=''; cnt.onclick=null;
        if(!multi&&first.rows&&first.rows.length){ cnt.classList.add('clk'); cnt.title='Ver o diff desta alteração'; cnt.onclick=(e)=>{ e.stopPropagation(); toggleInlineDiff(group,first.rows,first.adds,first.dels); }; }
        else if(!multi&&first.path){ cnt.classList.add('clk'); cnt.title='Ver diff no painel'; cnt.onclick=(e)=>{ e.stopPropagation(); openFile(first.path,'edit',opts); }; }
      }
      if(multi) renderGroupBody(group,opts);
    }
    function toolGroupEl(items,done,opts){
      const list=(items||[]).slice(), first=list[0]||{}, d=document.createElement('div'); d.className='strtool strgroup'; d._items=list; d.dataset.group='file';
      const head=document.createElement('div'); head.className='strtoolhead';
      const btn=document.createElement('button'); btn.type='button'; btn.className='xpand'; btn.title='Expandir alterações'; btn.textContent='▸'; head.appendChild(btn);
      const ico=document.createElement('span'); ico.textContent=toolIcon(first.name); head.appendChild(ico);
      const ttl=document.createElement('span'); ttl.className='ttl'; ttl.textContent=fileGroupTitle(list,done); head.appendChild(ttl);
      if(first.path){ ttl.classList.add('clk'); ttl.title='Abrir '+first.path; ttl.onclick=(e)=>{ e.stopPropagation(); openFile(first.path,'read',opts); }; }
      const counts=sumCounts(list); if(counts.adds||counts.dels){ const c=document.createElement('span'); c.className='tcnt total'; head.appendChild(c); }
      const body=document.createElement('div'); body.className='tdetail tgbody hidden'; d.appendChild(head); d.appendChild(body);
      btn.onclick=(e)=>{ e.stopPropagation(); const open=body.classList.toggle('hidden'); d.classList.toggle('expanded',!open); btn.textContent=open?'▸':'▾'; btn.title=open?'Expandir alterações':'Recolher alterações'; };
      refreshToolGroup(d,done,opts); if(done)d.classList.add('tdone'); return d;
    }
    function appendToolGroupItem(group,item,done,opts){ group._items=group._items||[]; group._items.push(item); refreshToolGroup(group,done,opts); if(done)group.classList.add('tdone'); else group.classList.remove('tdone'); }
    function repeatGroupTitle(items,done){
      const list=items||[], first=list[0]||{}, n=list.length, txt=(done?pastify(first.name,first.summary||first.name):(first.summary||first.name)||'').replace(/\s+/g,' ');
      const one=txt.length>96?txt.slice(0,93)+'…':txt;
      return `${one}${n>1?' · '+n+' vezes':''}`;
    }
    function refreshRepeatGroup(group,done){
      const items=group._items||[], first=items[0]||{}, title=repeatGroupTitle(items,done);
      group.dataset.sum=title; group.dataset.name=first.name||'Bash';
      group.classList.toggle('tbg',!!first.background);
      const ttl=group.querySelector('.ttl'); if(ttl)ttl.textContent=title;
      const body=group.querySelector('.tgbody'); if(body){ body.innerHTML=''; items.forEach((it,i)=>{ const row=document.createElement('div'); row.className='tgitem';
        const title=document.createElement('span'); title.className='tgtitle'; title.textContent=(i+1)+'. '+pastify(it.name,it.summary||it.name||'ação'); row.appendChild(title);
        if(it.detail){ const btn=document.createElement('button'); btn.type='button'; btn.className='xpand'; btn.textContent='▸'; btn.title='Ver detalhe'; const det=document.createElement('div'); det.className='tdiff hidden'; det.textContent=it.detail; btn.onclick=e=>{e.stopPropagation();const h=det.classList.toggle('hidden');btn.textContent=h?'▸':'▾';}; row.appendChild(btn); body.appendChild(row); body.appendChild(det); }
        else body.appendChild(row); }); }
    }
    function repeatGroupEl(items,done){
      const list=(items||[]).slice(), first=list[0]||{}, d=document.createElement('div'); d.className='strtool strrepeat'; d._items=list; d.dataset.group='repeat';
      const head=document.createElement('div'); head.className='strtoolhead';
      const btn=document.createElement('button'); btn.type='button'; btn.className='xpand'; btn.title='Expandir execuções'; btn.textContent='▸'; head.appendChild(btn);
      const ico=document.createElement('span'); ico.textContent=toolIcon(first.name); head.appendChild(ico);
      const ttl=document.createElement('span'); ttl.className='ttl'; head.appendChild(ttl);
      addToolBadges(head,first.background);
      const body=document.createElement('div'); body.className='tdetail tgbody hidden'; d.appendChild(head); d.appendChild(body);
      btn.onclick=e=>{e.stopPropagation();const h=body.classList.toggle('hidden');d.classList.toggle('expanded',!h);btn.textContent=h?'▸':'▾';btn.title=h?'Expandir execuções':'Recolher execuções';};
      refreshRepeatGroup(d,done); if(done)d.classList.add('tdone'); return d;
    }
    function appendRepeatGroupItem(group,item,done){ group._items=group._items||[]; group._items.push(item); refreshRepeatGroup(group,done); if(done)group.classList.add('tdone'); else group.classList.remove('tdone'); }
    // A tool-activity block (icon + summary + optional +/- counts). File tools are clickable
    // → open the viewer/diff panel. done=true shows past tense ("Editado"); reused by streaming
    // (present tense while running, flipped on done) AND by rebuilt history (already done).
    function toolRowEl(name,summary,path,adds,dels,done,rows,detail,opts){
      const d=document.createElement('div'); d.className='strtool'; d.dataset.name=name||''; d.dataset.sum=summary||'';
      const background=!!(opts&&opts.background); if(background)d.classList.add('tbg');
      const isFile=isFileToolName(name);
      const head=document.createElement('div'); head.className='strtoolhead';
      head.innerHTML=`<span>${toolIcon(name)}</span><span class="ttl">${esc((done?pastify(name,summary):summary)||name||'')}</span>`;
      addToolBadges(head,background);
      const ttl=head.querySelector('.ttl');
      // clicar no NOME → abre o arquivo (conteúdo)
      if(path&&isFile){ ttl.classList.add('clk'); ttl.title='Abrir '+path; ttl.onclick=(e)=>{ e.stopPropagation(); openFile(path,'read',opts); }; }
      // clicar na CONTAGEM → diff SÓ desta alteração, inline (fallback: painel do arquivo inteiro)
      if(adds||dels){ const c=document.createElement('span'); c.className='tcnt'; c.innerHTML=`<span class="fadd">+${adds||0}</span> <span class="fdel">-${dels||0}</span>`;
        if(rows&&rows.length){ c.classList.add('clk'); c.title='Ver o diff desta alteração'; c.onclick=(e)=>{ e.stopPropagation(); toggleInlineDiff(d,rows,adds,dels); }; }
        else if(path){ c.classList.add('clk'); c.title='Ver diff no painel'; c.onclick=(e)=>{ e.stopPropagation(); openFile(path,'edit',opts); }; }
        head.appendChild(c); }
      d.appendChild(head); if(name!=='Read')addExpand(d,(done?pastify(name,summary):summary)||'',detail); return d; }
    function thinkingEl(text,done,opts){
      const body=String(text||'Pensando...').trim()||'Pensando...';
      const d=document.createElement('div'); d.className='strtool thinkbox'; d.dataset.name='Thinking'; d.dataset.sum=body;
      if(done)d.classList.add('tdone'); if(opts&&opts.background)d.classList.add('tbg');
      const head=document.createElement('div'); head.className='strtoolhead';
      const btn=document.createElement('button'); btn.type='button'; btn.className='xpand'; btn.title='Expandir pensamento'; btn.textContent='▸'; head.appendChild(btn);
      const ico=document.createElement('span'); ico.textContent='◔'; head.appendChild(ico);
      const ttl=document.createElement('span'); ttl.className='ttl'; ttl.textContent='Pensando...'; head.appendChild(ttl);
      addToolBadges(head,!!(opts&&opts.background));
      const det=document.createElement('div'); det.className='tdetail hidden'; det.textContent=body;
      btn.onclick=(e)=>{ e.stopPropagation(); const h=det.classList.toggle('hidden'); d.classList.toggle('expanded',!h); btn.textContent=h?'▸':'▾'; btn.title=h?'Expandir pensamento':'Recolher pensamento'; };
      d.appendChild(head); d.appendChild(det); return d;
    }
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
    function setToolDone(block){ if(block.classList.contains('tdone'))return; if(block.classList.contains('thinkbox')){ const ttl=block.querySelector('.ttl'); if(ttl) ttl.textContent='Pensando...'; block.classList.add('tdone'); return; } if(block.classList.contains('strgroup')){ refreshToolGroup(block,true); block.classList.add('tdone'); return; } if(block.classList.contains('strrepeat')){ refreshRepeatGroup(block,true); block.classList.add('tdone'); return; } const nm=block.dataset.name, ttl=block.querySelector('.ttl'); if(ttl&&nm) ttl.textContent=pastify(nm,block.dataset.sum)||nm||''; block.classList.add('tdone'); }
    // Flip the tools ALREADY placed in a container to past tense ("Editando"→"Editado") the moment the
    // NEXT action in that container starts — a finished action shouldn't sit in present tense for the
    // rest of a long turn (it used to flip only when the WHOLE turn ended). Direct children only, so a
    // sub-agent box's internals aren't touched from the top level.
    function flipDone(container){ if(container) container.querySelectorAll(':scope > .strtool[data-name]:not(.tdone)').forEach(setToolDone); }
    // Texto do assistente renderizado como markdown e INTERCALADO com as ferramentas — a MESMA
    // aparência do fluxo principal do chat e do painel Trabalhos. Reaproveitado pelo corpo de um
    // sub-agente (expandido inline no chat) e por qualquer container de fluxo: `st` guarda o bloco
    // aberto (curTextEl/curTextRaw); closeFlowText o fecha para que o próximo texto abra um bloco
    // NOVO abaixo da ferramenta seguinte, preservando a ordem cronológica (como faz o nível raiz).
    function appendFlowText(container,st,text){ if(!text)return;
      if(!st.curTextEl){ flipDone(container); st.curTextEl=document.createElement('div'); st.curTextEl.className='strtext done'; st.curTextRaw=''; container.appendChild(st.curTextEl); }
      st.curTextRaw+=text; st.curTextEl.innerHTML=md(st.curTextRaw); }
    function closeFlowText(st){ if(st){ st.curTextEl=null; st.curTextRaw=''; } }
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
    function followupNoticeEl(m){
      const acts=Array.isArray(m&&m.activity)?m.activity:[];
      const bg=acts.find(ev=>ev&&ev.kind==='tool'&&ev.background);
      if(!bg)return null;
      const d=document.createElement('div'); d.className='followupnotice';
      const b=document.createElement('b'); b.textContent='Tarefa em segundo plano.';
      d.appendChild(b);
      d.appendChild(document.createTextNode(' O turno principal terminou, mas a IA iniciou um comando em segundo plano. Aguarde nova atualização ou peça status nesta sessão.'));
      if(bg.executionId){
        const btn=document.createElement('button'); btn.type='button'; btn.className='ghost'; btn.textContent='Abrir trabalho'; btn.style.cssText='margin-left:8px;padding:3px 8px;font-size:11.5px';
        btn.onclick=(e)=>{ e.stopPropagation(); openWorkPanel(); openWorkNode(bg.executionId); };
        d.appendChild(btn);
      }
      return d;
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
        }
        const fn=followupNoticeEl(m); if(fn)d.appendChild(fn); } return d; }
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
    function compactActivity(items){
      const fileCounts={};
      (items||[]).forEach(ev=>{ const k=ev&&ev.kind==='tool'&&fileGroupKey(ev); if(k)fileCounts[k]=(fileCounts[k]||0)+1; });
      const out=[], fileGroups={};
      (items||[]).forEach(ev=>{
        if(ev&&ev.kind==='thinking'&&isGenericThinking(ev.text))return;
        const fk=ev&&ev.kind==='tool'&&fileGroupKey(ev);
        if(fk&&fileCounts[fk]>1){
          if(fileGroups[fk]){ fileGroups[fk].items.push(ev); return; }
          const group={kind:'tool_group',parentId:ev.parentId,executionId:ev.executionId,items:[ev]};
          fileGroups[fk]=group; out.push(group); return;
        }
        if(fk){
          const prev=out[out.length-1];
          if(prev&&prev.kind==='tool_group'&&sameFileGroup(prev.items[0],ev)){ prev.items.push(ev); return; }
          if(prev&&prev.kind==='tool'&&sameFileGroup(prev,ev)){ out[out.length-1]={kind:'tool_group',parentId:prev.parentId,executionId:prev.executionId,items:[prev,ev]}; return; }
        }
        if(ev&&ev.kind==='tool'&&repeatToolKey(ev)){
          const prev=out[out.length-1];
          if(prev&&prev.kind==='tool_repeat_group'&&sameRepeatGroup(prev.items[0],ev)){ prev.items.push(ev); return; }
          if(prev&&prev.kind==='tool'&&sameRepeatGroup(prev,ev)){ out[out.length-1]={kind:'tool_repeat_group',parentId:prev.parentId,executionId:prev.executionId,items:[prev,ev]}; return; }
        }
        out.push(ev);
      });
      return out;
    }
    function normalizeActivity(events){ const out=[], tools={};
      const addTool=t=>{ const callKey=t.toolId?(t.parentId||'root')+'\0'+t.toolId:''; const readKey=readToolKey(t.name,t.path,t.summary,t.detail,t.parentId); const key=readKey||callKey,old=key&&tools[key]; if(old)Object.assign(old,t);else{if(key)tools[key]=t;out.push(t);} };
      (events||[]).forEach(ev=>{ if(ev&&ev.schemaVersion===1){
          if(ev.kind==='text_delta'||ev.kind==='text_block') out.push({kind:'text',text:ev.text||'',parentId:ev.parentId||(ev.tool&&ev.tool.parentId),executionId:ev.executionId});
          else if(ev.kind==='thinking') out.push({kind:'thinking',text:ev.text,parentId:ev.parentId,executionId:ev.executionId});
          else if(/^tool_/.test(ev.kind)&&ev.tool) addTool({kind:'tool',name:ev.tool.name,summary:ev.tool.summary,detail:ev.tool.detail,path:ev.tool.path,adds:ev.tool.adds,dels:ev.tool.dels,rows:ev.tool.rows,toolId:ev.tool.callId,parentId:ev.tool.parentId,status:ev.tool.status,error:ev.tool.error,executionId:ev.executionId,background:!!ev.tool.background});
          else if(ev.kind==='plan') out.push({kind:'tool',name:'Plan',summary:ev.plan&&ev.plan.title||ev.text||'Plano atualizado',status:'completed',parentId:ev.parentId,executionId:ev.executionId});
        } else if(ev&&ev.kind==='tool') addTool({...ev}); else out.push(ev); }); return compactActivity(out); }
    function renderActivityBlock(events,opts){
      const flow=document.createElement('div'); flow.className='strflow acthist';
      const subAgents={}; let curTextEl=null, curTextRaw='', rootText=false;
      function closeTextBlock(){ curTextEl=null; curTextRaw=''; }
      function ensureSA(id,desc,executionId){ if(subAgents[id]){ if(desc)subAgents[id].title.textContent=desc; if(executionId)bindInlineWork(subAgents[id],executionId); return subAgents[id]; }
        const wrap=document.createElement('div'); wrap.className='subagent'; wrap.dataset.id=id;
        wrap.innerHTML='<div class="sahead"><span class="satog">▾</span><span>🤖</span><span class="satitle"></span><span class="sastate"></span><span class="sacount">0</span><button type="button" class="saopen" title="Abrir em Trabalhos">abrir</button></div><div class="sabody"></div>';
        const head=wrap.querySelector('.sahead'), body=wrap.querySelector('.sabody'), title=wrap.querySelector('.satitle'), countEl=wrap.querySelector('.sacount'), tog=wrap.querySelector('.satog'), open=wrap.querySelector('.saopen');
        title.textContent=desc||'sub-agente';
        head.onclick=()=>{ const hid=body.classList.toggle('hidden'); tog.textContent=hid?'▸':'▾'; };
        closeTextBlock(); flow.appendChild(wrap);
        const rec={wrap,body,title,countEl,open,count:0,curTextEl:null,curTextRaw:''}; subAgents[id]=rec; if(executionId)bindInlineWork(rec,executionId); return rec; }
      normalizeActivity(events).forEach(ev=>{
        if(ev.kind==='tool_group'){
          if(ev.parentId){ const sa=ensureSA(ev.parentId,null,ev.executionId); closeFlowText(sa); sa.body.appendChild(toolGroupEl(ev.items,true,opts)); sa.count+=(ev.items||[]).length; sa.countEl.textContent=sa.count; return; }
          closeTextBlock(); flow.appendChild(toolGroupEl(ev.items,true,opts));
        } else if(ev.kind==='tool_repeat_group'){
          if(ev.parentId){ const sa=ensureSA(ev.parentId,null,ev.executionId); closeFlowText(sa); sa.body.appendChild(repeatGroupEl(ev.items,true)); sa.count+=(ev.items||[]).length; sa.countEl.textContent=sa.count; return; }
          closeTextBlock(); flow.appendChild(repeatGroupEl(ev.items,true));
        } else if(ev.kind==='tool'){
          if(ev.parentId){ const sa=ensureSA(ev.parentId,null,ev.executionId); closeFlowText(sa); sa.body.appendChild(toolRowEl(ev.name,ev.summary,ev.path,ev.adds,ev.dels,true,ev.rows,ev.detail,toolOpts(opts,ev))); sa.count++; sa.countEl.textContent=sa.count; return; }
          if((ev.name==='Task'||ev.name==='Agent')&&ev.toolId){ ensureSA(ev.toolId,(ev.summary||'').replace(/^Subagente:\s*/,'')||'sub-agente',ev.executionId); return; }
          closeTextBlock(); flow.appendChild(toolRowEl(ev.name,ev.summary,ev.path,ev.adds,ev.dels,true,ev.rows,ev.detail,toolOpts(opts,ev)));
        } else if(ev.kind==='text'){
          const t=ev.text||''; if(!t)return;
          if(ev.parentId){
            const sa=ensureSA(ev.parentId,null,ev.executionId);
            appendFlowText(sa.body,sa,t);
          } else {
            if(!curTextEl){ flipDone(flow); curTextEl=document.createElement('div'); curTextEl.className='strtext done'; curTextRaw=''; flow.appendChild(curTextEl); }
            curTextRaw+=t; curTextEl.innerHTML=md(curTextRaw); rootText=true;
          }
        } else if(ev.kind==='thinking'){ if(ev.parentId){const sa=ensureSA(ev.parentId,null,ev.executionId);closeFlowText(sa);sa.body.appendChild(thinkingEl(ev.text,true,opts));sa.count++;sa.countEl.textContent=sa.count;}else{closeTextBlock();flow.appendChild(thinkingEl(ev.text,true,opts));} }
      });
      if(rootText) flow.dataset.rootText='1';
      return flow.childNodes.length?flow:null; }
    // Trocar de sessão custa DUAS travessias de rede quando ela vive em outra máquina
    // (browser → hub → runner → hub → browser), e esse enlace pode ser um relay: medido entre
    // Notebook e o Desktop, o RTT oscila de 28ms a 621ms via DERP. O payload, porém, é o mesmo que
    // já desenhamos — então guardamos: revisitar pinta na hora e a cópia fresca só substitui
    // quando chega. Limitado a poucas sessões porque isso também roda no celular.
    function selectedRunner(){ return currentMachine==='all'?(routedMachine||'local'):(currentMachine||'local'); }
    function sessionStateKey(sid,runner){ return (runner||selectedRunner())+'\0'+(sid||''); }
    function sessionRunner(){ return currentSession?(currentSessionRunner||selectedRunner()):selectedRunner(); }
    function sessionValue(state,sid,runner){ return state[sessionStateKey(sid,runner)]; }
    const histCache=new Map(); const HIST_CACHE_MAX=12; let openingSession=null, pendingNewSession=null;
    const personalTurnSuggestions=new Map(), personalProactiveNotifications=new Map();
    function cacheHist(m){ if(!m||!m.sessionId)return; const key=sessionStateKey(m.sessionId,m.runnerId||selectedRunner()); histCache.delete(key); histCache.set(key,m);
      if(histCache.size>HIST_CACHE_MAX) histCache.delete(histCache.keys().next().value); }
    function dedupeSessionsList(list){
      const out=[], seen=new Set();
      (list||[]).forEach(s=>{ if(!s||!s.id)return; const key=(s.runnerId||'local')+'|'+s.id; if(seen.has(key))return; seen.add(key); out.push(s); });
      return out;
    }
    const optimisticSessions=new Map();
    function machineLabel(id){ const m=machines.find(x=>x.id===id); return (m&&m.label)||id||'local'; }
    const termMap={}, termOrder=[]; let termActive='';
    const termKey=(runner,id)=>(runner||'local')+'\0'+id;
    function termMachineLabel(runner){ return machineLabel(runner||selectedRunner()); }
    function termCwd(){ return curCwd||cfg.lastCwd||''; }
    function setTermEmpty(title,text){
      if(!E.termEmpty)return;
      E.termEmpty.classList.remove('hidden');
      E.termEmpty.innerHTML='<b></b><span></span>';
      E.termEmpty.querySelector('b').textContent=title||'Nenhum terminal aberto';
      E.termEmpty.querySelector('span').textContent=text||'Abra uma aba para executar comandos diretamente na máquina selecionada.';
    }
    function termFit(rec){
      if(!rec||!rec.term||!rec.fit)return;
      try{ rec.fit.fit(); tx({t:'terminal_resize',runnerId:rec.runnerId,terminalId:rec.id,cols:rec.term.cols,rows:rec.term.rows}); }catch(e){}
    }
    function renderTermTabs(){
      if(!E.termTabs)return; E.termTabs.innerHTML='';
      termOrder.filter(k=>termMap[k]).forEach(k=>{
        const rec=termMap[k], b=document.createElement('button'); b.type='button'; b.className='termtab'+(k===termActive?' active':''); b.title=(rec.cwd||'')+' · '+termMachineLabel(rec.runnerId);
        const lbl=document.createElement('span'); lbl.className='tlbl'; lbl.textContent=(rec.title||'Terminal')+' · '+termMachineLabel(rec.runnerId); b.appendChild(lbl);
        const x=document.createElement('button'); x.type='button'; x.className='tx'; x.textContent='✕'; x.title='Fechar terminal'; x.onclick=(e)=>{ e.stopPropagation(); tx({t:'terminal_close',runnerId:rec.runnerId,terminalId:rec.id}); closeTermLocal(k,false); };
        b.appendChild(x); b.onclick=()=>selectTerm(k); E.termTabs.appendChild(b);
      });
      if(E.termEmpty)E.termEmpty.classList.toggle('hidden',termOrder.some(k=>termMap[k]));
      if(E.termMeta){ const rec=termMap[termActive]; E.termMeta.textContent=rec?`${termMachineLabel(rec.runnerId)} · ${rec.cwd||'pasta padrão'}`:`${machineLabel(selectedRunner())} · pasta da sessão`; }
    }
    function selectTerm(k){
      if(!termMap[k])return; termActive=k;
      Object.keys(termMap).forEach(x=>{ if(termMap[x].pane)termMap[x].pane.classList.toggle('hidden',x!==k); });
      renderTermTabs(); setTimeout(()=>{ const rec=termMap[k]; if(rec){ termFit(rec); try{rec.term.focus();}catch(e){} } },0);
    }
    function closeTermLocal(k){
      const rec=termMap[k]; if(!rec)return;
      try{ rec.term.dispose(); }catch(e){}
      if(rec.pane&&rec.pane.parentNode)rec.pane.parentNode.removeChild(rec.pane);
      delete termMap[k]; const i=termOrder.indexOf(k); if(i>=0)termOrder.splice(i,1);
      if(termActive===k) termActive=termOrder.find(x=>termMap[x])||'';
      if(termActive) selectTerm(termActive); else renderTermTabs();
    }
    function ensureTerm(terminal,runnerId){
      if(!terminal||!terminal.id||!E.termBody)return null; const runner=runnerId||selectedRunner(), k=termKey(runner,terminal.id);
      let rec=termMap[k]; if(rec){ Object.assign(rec,{title:terminal.title||rec.title,cwd:terminal.cwd||rec.cwd,shell:terminal.shell||rec.shell,runnerId:runner}); renderTermTabs(); return rec; }
      const pane=document.createElement('div'); pane.className='termpane hidden'; pane.dataset.key=k; E.termBody.appendChild(pane);
      const Term=window.Terminal, Fit=window.FitAddon&&window.FitAddon.FitAddon;
      if(!Term){ pane.classList.remove('hidden'); pane.textContent='xterm não carregou'; if(E.termPanel){ E.termPanel.classList.remove('hidden'); E.termPanel.setAttribute('aria-hidden','false'); } if(E.termEmpty)E.termEmpty.classList.add('hidden'); return null; }
      pane.classList.remove('hidden');
      const term=new Term({ cursorBlink:true, convertEol:false, scrollback:8000, fontFamily:'ui-monospace, Menlo, Consolas, monospace', fontSize:13, theme:{ background:'#05070a', foreground:'#d1d5db', cursor:'#93c5fd', selectionBackground:'#2563eb55' } });
      const fit=Fit?new Fit():null; if(fit)term.loadAddon(fit); term.open(pane);
      rec=termMap[k]={ id:terminal.id, title:terminal.title||'Terminal', cwd:terminal.cwd||'', shell:terminal.shell||'', runnerId:runner, term, fit, pane };
      term.onData(data=>tx({t:'terminal_input',runnerId:runner,terminalId:terminal.id,data}));
      term.onResize(size=>tx({t:'terminal_resize',runnerId:runner,terminalId:terminal.id,cols:size.cols,rows:size.rows}));
      termOrder.push(k); if(E.termPanel){ E.termPanel.classList.remove('hidden'); E.termPanel.setAttribute('aria-hidden','false'); } selectTerm(k); setTimeout(()=>termFit(rec),50); return rec;
    }
    function openTermPanel(create){
      if(!E.termPanel)return; E.termPanel.classList.remove('hidden'); E.termPanel.setAttribute('aria-hidden','false'); renderTermTabs();
      if(create!==false) newTerminal(); else tx({t:'terminal_list',runnerId:selectedRunner()});
    }
    function closeTermPanel(){ if(!E.termPanel)return; E.termPanel.classList.add('hidden'); E.termPanel.setAttribute('aria-hidden','true'); }
    async function newTerminal(){
      let runnerId=selectedRunner(), cwd=termCwd();
      // Escolher a máquina onde o terminal abre (paridade com "nova sessão"). Só pergunta quando há
      // mais de uma máquina; ao trocar de máquina, deixa o cwd em branco (a máquina remota usa o dela).
      if(machines.length>1){ const mid=await pickMachine('Abrir terminal','Escolha a máquina onde o terminal vai rodar.'); if(!mid)return; if(mid!==runnerId){ runnerId=mid; cwd=''; if(currentMachine==='all')routedMachine=mid; } }
      const reqId='term-'+uid(); tx({t:'terminal_open',reqId,runnerId,cwd,cols:100,rows:30,title:machineLabel(runnerId)});
      if(E.termMeta)E.termMeta.textContent='Abrindo terminal em '+machineLabel(runnerId)+'…';
      setTermEmpty('Abrindo terminal…','Aguardando resposta de '+machineLabel(runnerId)+'.');
    }
    const termResizeObs=window.ResizeObserver?new ResizeObserver(()=>{ const rec=termMap[termActive]; if(rec)termFit(rec); }):null;
    if(termResizeObs&&E.termBody)termResizeObs.observe(E.termBody);
    function optimisticKey(s){ return (s.runnerId||'local')+'|'+s.id; }
    function mergeOptimisticSessions(list){
      const base=dedupeSessionsList(list), seen=new Set(base.map(optimisticKey)), now=Date.now(), fresh=[];
      for(const [key,s] of optimisticSessions){ if(seen.has(key)){ optimisticSessions.delete(key); continue; } if((s._until||0)<now){ optimisticSessions.delete(key); continue; } fresh.push(s); }
      return dedupeSessionsList([...fresh,...base]);
    }
    function upsertOptimisticSession(s){ if(!s||!s.id)return; const item={...s,_until:Date.now()+30000}; optimisticSessions.set(optimisticKey(item),item); sessions=mergeOptimisticSessions([item,...sessions]); renderRecents(); }
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
      E.title.textContent=s.title||'Carregando sessão...'; refreshTitleInfo(); syncModelEffort(); clearLimitBanner();
      clearPending(); streamErr(); seenAgentEvents.clear(); liveTurnId=null; debateProgressEl=null; debateProgressId=null; E.log.innerHTML='';
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
    function openSession(id,runnerId){ if(!id)return; wfRun=null; if(E.wfRun){E.wfRun.classList.add('hidden');E.wfRun.innerHTML='';} try{renderWfStep();}catch(e){} wfTaskBinding=null; wfLocalFiles=null; wfLocalShow=false; setTimeout(()=>{ if(authUser&&authUser.role==='owner'){ tx({t:'workflow_runs',sessionId:id}); tx({t:'task_binding_get',sessionId:id}); } tx({t:'workflow_list'}); },60);
      if(typeof findState!=='undefined'&&findState)closeFind(); if(typeof findRegion!=='undefined')findRegion='chat';  // abriu sessão → foco no chat; fecha barra órfã
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
      // Adopt the server's permission-mode seed (new session: inherited/config; existing: stored) into
      // this session's pref so the picker reflects it — without clobbering an explicit local choice.
      { const spm=(m.session||{}).permissionMode; if(spm){ const key=sessionStateKey(m.sessionId,targetRunner), pr=Object.assign({},sessionValue(sessionPrefs,m.sessionId,targetRunner)||{}); if(!pr.permissionMode){ pr.permissionMode=spm; sessionPrefs[key]=pr; saveSessionPrefs(); } } }
      if(curCwd && !curNative){cfg.lastCwd=curCwd;saveCfg();} curStarted=(m.messages||[]).length>0; maybeRestoreTree();
      E.title.textContent=(m.session||{}).title||'Sessão'; refreshTitleInfo(); syncModelEffort(); clearLimitBanner(); clearPending(); streamErr(); seenAgentEvents.clear(); liveTurnId=null; debateProgressEl=null; debateProgressId=null; E.log.innerHTML='';
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
      curNativeWritable=curNative&&!!(m.session||{}).writable;
      E.roBanner.classList.toggle('hidden',!curNative);
      E.roBanner.innerHTML = '🔗 Sessão nativa da máquina'+(currentAgent?' ('+esc(currentAgent)+')':'');
      E.input.disabled=false; E.sendBtn.disabled=false; E.mic.disabled=false; E.input.placeholder='Fale ou digite…';
      if(switchingSession){ E.input.value=sessionValue(draftBySession,m.sessionId,targetRunner)||''; E.input.style.height='auto'; E.input.style.height=E.input.scrollHeight+'px'; restoreAttachments(m.sessionId,targetRunner); }
      curNativeId=(!curNative && (m.session||{}).nativeId) ? (m.session||{}).nativeId : ''; renderNativeChip(); setHash(currentSession);
      { const savedAsk=getAsk(m.sessionId,sessionRunner()); if(savedAsk&&savedAsk.length&&!askActive) renderAskCard(savedAsk,sessionRunner()); }   // restaura decision-card pendente (lock/reload)
      if(!stagingActive) tx({t:'stage_state',sessionId:m.sessionId});   // restaura painel de refino de voz, se houver (lock/reload)
      renderPersonalTurnSuggestionForCurrent(true);
      renderStoredSearchCards();   // reinjeta os cards de sugestão guardados desta sessão (sobrevivem a navegar/reload)
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
    // ---- gerente central de áudio: serializa TODA reprodução (evita sobreposição de clips),
    //      rastreia o handle atual (stop mata tudo, inclusive clips não-TTS) e mantém a ordem FIFO
    //      (ex.: 1º o resultado da análise, 2º as perguntas). onEnd só dispara em término NATURAL
    //      (não em stop/barge-in), pra não re-armar o mic ao ser interrompido. A promise SEMPRE resolve.
    const audioMgr=(()=>{ let queue=[], cur=null, curItem=null;
      function decode(b64){ const b=atob(b64),u=new Uint8Array(b.length); for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i); return URL.createObjectURL(new Blob([u],{type:'audio/wav'})); }
      function next(){ if(cur) return; const item=queue.shift(); if(!item){ curItem=null; ttsPlaying=false; curTtsAudio=null; return; }
        curItem=item; let url; try{ url=decode(item.b64); }catch(e){ curItem=null; item.resolve(); next(); return; }
        const a=new Audio(url); cur=a; ttsPlaying=true; curTtsAudio=a;
        const fin=()=>{ if(cur!==a) return; try{ URL.revokeObjectURL(url); }catch(e){} cur=null; curItem=null; try{ if(item.onEnd) item.onEnd(); }catch(e){} item.resolve(); next(); };
        a.onended=fin; a.onerror=fin; a.play().catch(fin); }
      function flush(){ const pend=queue.slice(); queue=[]; const ci=curItem; curItem=null; if(cur){ try{ cur.pause(); }catch(e){} cur=null; } ttsPlaying=false; curTtsAudio=null; if(ci) ci.resolve(); pend.forEach(it=>it.resolve()); }
      return {
        play(b64,opts){ opts=opts||{}; return new Promise(res=>{ const item={b64,onEnd:opts.onEnd,resolve:res}; if(opts.jump) flush(); queue.push(item); next(); }); },
        stop(){ flush(); },
        get active(){ return !!cur || queue.length>0; } }; })();
    function stopTTS(){ audioMgr.stop(); }
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
    // ---- Modo Manual (Fase 3): card de aprovação de ferramenta ----
    function permInputSummary(tool,input){ input=input||{};
      if(tool==='Bash') return String(input.command||'').replace(/\s+/g,' ').slice(0,160);
      if(input.file_path) return String(input.file_path);
      if(input.path) return String(input.path);
      if(input.url) return String(input.url);
      if(input.pattern) return String(input.pattern);
      if(input.command) return String(input.command).replace(/\s+/g,' ').slice(0,160);
      return ''; }
    function permInputDetail(input){ try{ const s=JSON.stringify(input||{},null,1); if(!s||s.length<=2) return ''; return s.length>2000?s.slice(0,2000)+'\n… (truncado)':s; }catch(e){ return ''; } }
    function renderPermissionCard(m){
      const id=m.id; if(!id) return;
      if(E.log.querySelector('.permcard[data-id="'+id+'"]')) return; // idempotente
      const card=document.createElement('div'); card.className='msg bot permcard'; card.dataset.id=id;
      const hd=document.createElement('div'); hd.className='askhd';
      const lbl=document.createElement('span'); lbl.textContent='🔐 Pedido de permissão'; hd.appendChild(lbl); card.appendChild(hd);
      const summary=permInputSummary(m.tool,m.input);
      const q=document.createElement('div'); q.className='askq'; q.textContent=(m.tool||'ferramenta')+(summary?' · '+summary:''); card.appendChild(q);
      const detail=permInputDetail(m.input);
      if(detail){ const pre=document.createElement('pre'); pre.style.cssText='margin:6px 0 0;padding:8px;background:rgba(0,0,0,.25);border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-word;max-height:180px;overflow:auto'; pre.textContent=detail; card.appendChild(pre); }
      const nav=document.createElement('div'); nav.className='asknav';
      const deny=document.createElement('button'); deny.type='button'; deny.className='ghost'; deny.textContent='Negar';
      const sp=document.createElement('span'); sp.className='grow';
      const allow=document.createElement('button'); allow.type='button'; allow.textContent='Aprovar ✓';
      const answer=(behavior)=>{ tx({t:'permission_decision', id, behavior}); card.classList.add('done'); nav.remove(); };
      deny.onclick=()=>answer('deny'); allow.onclick=()=>answer('allow');
      nav.appendChild(deny); nav.appendChild(sp); nav.appendChild(allow); card.appendChild(nav);
      E.log.appendChild(card); autoScroll();
    }
    function removePermissionCard(id){ const c=E.log.querySelector('.permcard[data-id="'+id+'"]'); if(c)c.remove(); }
    // ---- wizard de VOZ dos cards de decisão ----
    function startAskVoice(){ if(!askActive)return; askVoice=true; askVoiceStep(); }
    function askVoiceStep(){ const st=askActive; if(!st||!askVoice)return; const q=st.questions[st.step];
      const spoken=`${q.question}. Opções: ${q.options.map((o,i)=>(i+1)+', '+o.label).join('; ')}. Ou diga outros. Diga voltar ou avançar para navegar.`;
      status('speaking',t('stAsking')); tx({t:'say',text:spoken,sessionId:currentSession}); }
    function playClip(b64){ return audioMgr.play(b64); }   // clip do wizard de voz: entra na MESMA fila (nunca sobrepõe)
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
    let pendingEl=null, pendingTimer=null, pendingStart=0, pendingLabel='Jarvis trabalhando…', nativeActivityTimer=null;
    function showPending(label){ pendingLabel=label||'Jarvis trabalhando…'; if(pendingEl)return; pendingStart=Date.now(); pendingEl=document.createElement('div'); pendingEl.className='msg bot pending';
      const upd=()=>{ if(!pendingEl)return; const s=Math.floor((Date.now()-pendingStart)/1000); const t=s>=60?`${Math.floor(s/60)}m ${s%60}s`:`${s}s`;
        pendingEl.innerHTML=`<span class="work"><span class="spin"></span>${esc(pendingLabel)} ${t}</span>`; };
      upd(); pendingTimer=setInterval(upd,1000); E.log.appendChild(pendingEl); updateStopStatus(); autoScroll(); }
    function clearPending(){ if(nativeActivityTimer){ clearTimeout(nativeActivityTimer); nativeActivityTimer=null; } if(pendingTimer){ clearInterval(pendingTimer); pendingTimer=null; } if(pendingEl){ pendingEl.remove(); pendingEl=null; } pendingLabel='Jarvis trabalhando…'; }
    function markNativeActivity(){ if(!curNative)return; showPending('Sessão nativa com atividade…'); if(nativeActivityTimer)clearTimeout(nativeActivityTimer); nativeActivityTimer=setTimeout(()=>{ nativeActivityTimer=null; clearPending(); },45000); }
    function clearNativeActivity(){ if(!nativeActivityTimer)return; clearPending(); }
    // ---- streaming (atividade ao vivo: ferramentas + texto) ----
    const toolIcon = n => ({Bash:'🖥',Read:'📄',Edit:'✏️',Write:'✏️',NotebookEdit:'✏️',MultiEdit:'✏️',Grep:'🔎',Glob:'📁',Task:'🤖',Agent:'🤖',WebFetch:'🌐',WebSearch:'🌐',Thinking:'◔',Plan:'📋'}[n]||'🔧');
    // strFlow = container ordenado; curTextEl = bloco de texto aberto (null após uma ferramenta,
    // pra o próximo texto virar um bloco NOVO); curTextRaw = markdown acumulado desse bloco.
    let strEl=null, strFlow=null, curTextEl=null, curTextRaw='', streamTextRaw='', sawText=false, strTimer=null, strStart=0, strTimeEl=null, subAgents={}, liveTools={}, liveFileGroups={}, liveLastGroupKey={}, looseActivityGroups={}, looseActivityEls=[], looseLastGroupKey='', turnUsage=null, seenAgentEvents=new Set(), liveTurnId=null, cleanCancel=false, lastStreamAssistant=null;
    function assistantTextKey(text){ return String(text||'').replace(/\s+/g,' ').trim(); }
    function rememberStreamAssistant(text,sessionId,runner){
      const key=assistantTextKey(text); if(!key)return;
      lastStreamAssistant={key,sessionId:sessionId||currentSession,runner:runner||sessionRunner(),at:Date.now()};
    }
    function recentlyStreamedAssistant(text,sessionId,runner){
      const key=assistantTextKey(text), rec=lastStreamAssistant;
      return !!(key&&rec&&rec.key===key&&rec.sessionId===(sessionId||currentSession)&&rec.runner===(runner||sessionRunner())&&Date.now()-rec.at<15000);
    }
    function streamStartUI(startedAt){ if(strEl)return; clearPending(); curTextEl=null; curTextRaw=''; streamTextRaw=''; sawText=false; const at=Number(startedAt); strStart=Number.isFinite(at)&&at>0?Math.min(at,Date.now()):Date.now(); subAgents={}; liveTools={}; liveFileGroups={}; liveLastGroupKey={}; turnUsage=null;
      strEl=document.createElement('div'); strEl.className='msg bot streaming';
      // loading + timer FICAM NO FIM do bloco (abaixo da atividade): strflow primeiro, strhead depois.
      strEl.innerHTML='<div class="strflow"></div><div class="strhead"><span class="spin"></span><span class="strtime">0s</span></div>';
      strTimeEl=strEl.querySelector('.strtime'); strFlow=strEl.querySelector('.strflow');
      strTimer=setInterval(()=>{ if(!strTimeEl)return; const s=Math.floor((Date.now()-strStart)/1000); strTimeEl.textContent=(s>=60?`${Math.floor(s/60)}m ${s%60}s`:`${s}s`); },1000);
      E.log.appendChild(strEl); autoScroll(); }
    function closeTextBlock(){ curTextEl=null; curTextRaw=''; }   // próximo texto abre bloco novo (após tool)
    function liveScope(parentId){ return parentId||'root'; }
    function breakLiveGroup(parentId){ liveLastGroupKey[liveScope(parentId)]=''; }
    // A collapsible container for one spawned sub-agent (Task tool). Its nested tool calls +
    // text preview show "o que ele está fazendo"; the count badge shows progress at a glance.
    function ensureSubAgent(id,desc,executionId){ if(!strFlow)streamStartUI(); if(subAgents[id]){ if(desc)subAgents[id].title.textContent=desc; if(executionId)bindInlineWork(subAgents[id],executionId); return subAgents[id]; }
      const wrap=document.createElement('div'); wrap.className='subagent'; wrap.dataset.id=id;
      wrap.innerHTML='<div class="sahead"><span class="satog">▾</span><span>🤖</span><span class="satitle"></span><span class="sastate"></span><span class="sacount">0</span><button type="button" class="saopen" title="Abrir em Trabalhos">abrir</button></div><div class="sabody"></div>';
      const head=wrap.querySelector('.sahead'), body=wrap.querySelector('.sabody'), title=wrap.querySelector('.satitle'), countEl=wrap.querySelector('.sacount'), tog=wrap.querySelector('.satog'), open=wrap.querySelector('.saopen');
      title.textContent=desc||'sub-agente';
      head.onclick=()=>{ const hid=body.classList.toggle('hidden'); tog.textContent=hid?'▸':'▾'; };
      closeTextBlock(); strFlow.appendChild(wrap);
      const rec={wrap,body,title,countEl,open,count:0,curTextEl:null,curTextRaw:''}; subAgents[id]=rec; if(executionId)bindInlineWork(rec,executionId); return rec; }
    function bindInlineWork(rec,executionId){ if(!rec||!rec.open||!executionId)return; rec.wrap.dataset.executionId=executionId; rec.open.classList.add('ready'); rec.open.onclick=e=>{e.stopPropagation();openWorkPanel();openWorkNode(executionId);}; const n=workNodes.get(executionId);if(n){if(n.title)rec.title.textContent=n.title;rec.wrap.dataset.state=n.state||'unknown';const state=rec.wrap.querySelector('.sastate');if(state)state.textContent=workStateLabel(n.state).toLowerCase();} }
    function appendLiveTool(container,item,done,opts){
      const fk=fileGroupKey(item), rk=repeatToolKey(item), k=fk||rk, scope=liveScope(item.parentId);
      if(fk&&liveFileGroups[fk]&&liveFileGroups[fk].isConnected){ const g=liveFileGroups[fk]; appendToolGroupItem(g,item,done,opts); liveLastGroupKey[scope]=fk; return g; }
      if(rk&&liveLastGroupKey[scope]===rk&&liveFileGroups[rk]&&liveFileGroups[rk].isConnected){ const g=liveFileGroups[rk]; appendRepeatGroupItem(g,item,done); return g; }
      if(k){ flipDone(container); const g=fk?toolGroupEl([item],done,toolOpts(opts,item)):repeatGroupEl([item],done); container.appendChild(g); liveFileGroups[k]=g; liveLastGroupKey[scope]=k; return g; }
      breakLiveGroup(item.parentId); const row=toolRowEl(item.name,item.summary,item.path,item.adds,item.dels,done,item.rows,item.detail,toolOpts(opts,item)); container.appendChild(row); return row;
    }
    function streamTool(name,summary,toolId,parentId,path,adds,dels,rows,detail,status,error,executionId,background){ if(!strFlow)streamStartUI();
      const item={kind:'tool',name,summary,path,adds,dels,rows,detail,toolId,parentId,status,error,executionId,background};
      const done=status!=='started';
      const readKey=readToolKey(name,path,summary,detail,parentId);
      const liveKey=readKey||(toolId?(parentId||'root')+'\0'+toolId:'');
      if(liveKey&&liveTools[liveKey]){ const row=liveTools[liveKey]; if(row.classList.contains('strgroup')){ const list=row._items||[], hit=list.find(x=>x.toolId&&x.toolId===toolId)||(list[list.length-1]||{}); Object.assign(hit,item); refreshToolGroup(row,done); } else if(row.classList.contains('strrepeat')){ const list=row._items||[], hit=list.find(x=>x.toolId&&x.toolId===toolId)||(list[list.length-1]||{}); Object.assign(hit,item); refreshRepeatGroup(row,done); } else if(summary){row.dataset.sum=summary;const ttl=row.querySelector('.ttl');if(ttl)ttl.textContent=(done?pastify(name,summary):summary)||name||'';} if(done)setToolDone(row); if(status==='failed'){row.classList.add('terr');row.title=error||'Falha na ferramenta';} autoScroll(); return; }
      if(parentId){ const sa=ensureSubAgent(parentId,null,executionId); closeFlowText(sa); if(!fileGroupKey(item)&&!repeatToolKey(item))flipDone(sa.body); const row=appendLiveTool(sa.body,item,done); if(status==='failed'){row.classList.add('terr');row.title=error||'Falha na ferramenta';} if(liveKey)liveTools[liveKey]=row; sa.count++; sa.countEl.textContent=sa.count; autoScroll(); return; }
      if((name==='Task'||name==='Agent')&&toolId){ breakLiveGroup(parentId); flipDone(strFlow); ensureSubAgent(toolId,(summary||'').replace(/^Subagente:\s*/,'')||'sub-agente',executionId); autoScroll(); return; }
      closeTextBlock(); if(!fileGroupKey(item)&&!repeatToolKey(item))flipDone(strFlow); const row=appendLiveTool(strFlow,item,done); if(status==='failed'){row.classList.add('terr');row.title=error||'Falha na ferramenta';} if(liveKey)liveTools[liveKey]=row; autoScroll(); }
    function streamThinking(text,parentId,executionId){ if(isGenericThinking(text))return; breakLiveGroup(parentId); if(!strFlow)streamStartUI();
      const row=thinkingEl(text,false,null);
      if(parentId){ const sa=ensureSubAgent(parentId,null,executionId); closeFlowText(sa); flipDone(sa.body); sa.body.appendChild(row); sa.count++; sa.countEl.textContent=sa.count; autoScroll(); return; }
      closeTextBlock(); flipDone(strFlow); strFlow.appendChild(row); autoScroll(); }
    function streamText(t,parentId,executionId){
      breakLiveGroup(parentId);
      if(parentId){ const sa=ensureSubAgent(parentId,null,executionId); appendFlowText(sa.body,sa,t); autoScroll(); return; }
      if(!strFlow)streamStartUI();
      // Abre um bloco NOVO de texto se o anterior foi fechado por uma ferramenta; senão acumula.
      // Um novo bloco de texto significa que as ferramentas anteriores já terminaram → passa pra passado.
      if(!curTextEl){ flipDone(strFlow); curTextEl=document.createElement('div'); curTextEl.className='strtext done'; curTextRaw=''; strFlow.appendChild(curTextEl); }
      curTextRaw+=t; streamTextRaw+=t; curTextEl.innerHTML=md(curTextRaw); sawText=true; autoScroll(); }
    function streamFinish(){ strEl=strFlow=curTextEl=strTimeEl=null; curTextRaw=''; streamTextRaw=''; sawText=false; liveTools={}; liveFileGroups={}; liveLastGroupKey={}; turnUsage=null; }
    function usageCostText(usage,digits=4){ if(!usage||!(usage.costUsd>=0))return''; const p=usage.costKind==='billed'?'$':usage.costKind==='estimated_api_equivalent'?'≈$':'Σ$'; return p+Number(usage.costUsd||0).toFixed(digits); }
    function usageSummary(usage){ if(!usage)return''; const cost=usageCostText(usage); const toks=usage.outputTokens||0; const kind=usage.costKind==='billed'?'cobrado reportado':usage.costKind==='estimated_api_equivalent'?'equivalente estimado':usage.costKind==='subscription_included'?'incluído na assinatura':usage.costKind==='tokens_only'?'somente tokens':'custo indisponível'; return `${cost?cost+' · ':''}${toks} tokens · ${kind}`; }
    function streamDone(finalText,usage,meta){ const sid=(meta&&meta.sessionId)||currentSession, runner=(meta&&meta.runner)||sessionRunner(); if(strTimer){clearInterval(strTimer);strTimer=null;}
      if(!strEl){ if(recentlyStreamedAssistant(finalText,sid,runner))return; rememberStreamAssistant(finalText,sid,runner); addMsg({role:'assistant',text:finalText||''}); return; }
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
      rememberStreamAssistant(finalText||streamTextRaw,sid,runner);
      streamFinish(); autoScroll(); }
    function streamCancelled(reason){ if(strTimer){clearInterval(strTimer);strTimer=null;} clearPending();
      if(currentSession) delete stopping[sessionStateKey(currentSession,currentSessionRunner)]; updateStopStatus();   // parou → limpa o "parando…" da sessão
      if(cleanCancel){ cleanCancel=false; if(strEl)strEl.remove(); streamFinish(); autoScroll(); return; }  // cancel limpo: a msg voltou ao input → sem bloco "interrompido"
      if(strEl){ const head=strEl.querySelector('.strhead'); if(head) head.remove();
        strEl.querySelectorAll('.strtool[data-name]').forEach(setToolDone);
        const n=document.createElement('div'); n.className='usage'; n.textContent='⏹ '+(reason||'interrompido'); strEl.appendChild(n);
        streamFinish(); }
      else addErr('⏹ '+(reason||'interrompido')); autoScroll(); }
    function streamErr(message){ if(strTimer){clearInterval(strTimer);strTimer=null;} clearPending(); if(strEl){ const head=strEl.querySelector('.strhead'); if(head)head.remove(); strEl.querySelectorAll('.strtool[data-name]').forEach(setToolDone); strEl.appendChild(errorBoxEl(message||'Falha na execução')); streamFinish(); } else addErr(message||'Falha na execução'); autoScroll(); }
    function stripAnsi(s){ return String(s||'').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g,''); }
    function compactErrorSummary(text,title){
      const clean=stripAnsi(text).replace(/^erro:\s*/i,'').trim();
      if(!clean)return title||'Falha na execução';
      if(/(?:limite|usage limit|rate limit|quota|429)/i.test(clean))return 'Limite atingido. Detalhes disponíveis abaixo.';
      const line=(clean.split(/\r?\n/).map(x=>x.trim()).find(Boolean)||clean).replace(/\s+/g,' ');
      return line.length>180?line.slice(0,177)+'…':line;
    }
    function errorTitle(text,opts){
      if(opts&&opts.title)return opts.title;
      return (opts&&opts.limit)||/(?:limite|usage limit|rate limit|quota|429)/i.test(String(text||''))?'Limite de uso atingido':'Falha na execução';
    }
    function compactErrorDetail(text){
      const clean=stripAnsi(text).trim();
      const max=80000;
      if(clean.length<=max)return clean;
      const keep=Math.floor((max-180)/2), omitted=clean.length-(keep*2);
      return clean.slice(0,keep)+'\n\n... detalhe encurtado na interface: '+omitted+' caracteres no meio ...\n\n'+clean.slice(-keep);
    }
    function clearLimitBanner(){ if(!E.limit)return; E.limit.textContent=''; E.limit.title=''; E.limit.classList.add('hidden'); }
    function errorBoxEl(text,opts={}){
      const full=stripAnsi(text||'Falha na execução').trim()||'Falha na execução', title=errorTitle(full,opts), summary=opts.summary||compactErrorSummary(full,title), detail=compactErrorDetail(full);
      const box=document.createElement('div'); box.className='errbox';
      const head=document.createElement('div'); head.className='errhead';
      const mark=document.createElement('span'); mark.className='errmark'; mark.textContent='⚠'; head.appendChild(mark);
      const copy=document.createElement('div'); copy.className='errtext';
      const ttl=document.createElement('span'); ttl.className='errtitle'; ttl.textContent=title; copy.appendChild(ttl);
      if(summary&&summary!==title){ const sum=document.createElement('span'); sum.className='errsummary'; sum.textContent=' — '+summary; copy.appendChild(sum); }
      head.appendChild(copy);
      if(detail&&detail!==summary&&detail!==title){
        const btn=document.createElement('button'); btn.type='button'; btn.className='errtoggle'; btn.textContent='Ver detalhes'; btn.setAttribute('aria-expanded','false');
        const det=document.createElement('div'); det.className='errdetail hidden'; det.textContent=detail;
        btn.onclick=(e)=>{ e.stopPropagation(); const open=det.classList.toggle('hidden'); btn.textContent=open?'Ver detalhes':'Recolher'; btn.setAttribute('aria-expanded',String(!open)); };
        head.appendChild(btn); box.appendChild(head); box.appendChild(det);
      } else box.appendChild(head);
      return box;
    }
    function addErr(t,opts){ const d=document.createElement('div'); d.className='msg err'; d.appendChild(errorBoxEl(t,opts)); E.log.appendChild(d); autoScroll(); }
    // Um box de sugestão referencia uma sessão existente (id/agent/why). O `action` (quando existe) é o
    // texto pronto pra rodar; clicar no box OU no ▶ LANÇA a ação numa sessão NOVA (sem sair daqui) —
    // "↗ ver sessão" abre a sessão referenciada só pra inspecionar. Sem action é busca literal → abre.
    function matchRowHtml(x,action){ return `<div class="match" data-id="${esc(x.id)}" data-runner="${esc(x.runnerId||'')}"${action?` data-action="${esc(action)}"`:''}>`+
        `📂 <b>${esc(x.title||x.id)}</b> <span class="chip">${esc(x.agent||'')}</span>`+
        (x.why||x.progress?`<br><span class="mut">${esc(x.why||x.progress||'')}</span>`:'')+
        (action?`<div class="matchacts" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">`+
          `<button type="button" class="exec ghost" data-id="${esc(x.id)}" data-runner="${esc(x.runnerId||'')}" data-action="${esc(action)}">▶ executar ação</button>`+
          `<button type="button" class="refopen ghost" data-id="${esc(x.id)}" data-runner="${esc(x.runnerId||'')}">↗ ver sessão</button></div>`:'')+
        `</div>`; }
    function searchCardInner(m,omitQuery){ return (omitQuery?'':'<b>🔎 '+esc(m.query||'')+'</b>')+md(m.answer||'')+(m.matches||[]).map(x=>matchRowHtml(x,m.action)).join(''); }
    function searchCardHtml(m){ return searchCardInner(m,false); }   // usado só no modal de busca (transiente)
    // Card persistente no chat: cabeçalho com minimizar/dispensar. `rec` é o MESMO objeto guardado em
    // searchCardsBySession — mutar rec.minimized/dismissed e salvar persiste o estado.
    function buildSearchCardEl(rec){ const d=document.createElement('div'); d.className='msg bot searchcard'; d.dataset.cid=rec.cid;
      const head=document.createElement('div'); head.className='searchcard-head'; head.style.cssText='display:flex;align-items:center;gap:6px;margin-bottom:4px';
      const ttl=document.createElement('div'); ttl.className='searchcard-title'; ttl.style.cssText='flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;opacity:.9'; ttl.textContent='🔎 '+String(rec.query||'Sugestões').slice(0,90);
      const min=document.createElement('button'); min.type='button'; min.className='ghost searchcard-min'; min.style.cssText='border:0;background:none;cursor:pointer;font-size:14px;padding:0 4px'; min.title='Minimizar';
      const dis=document.createElement('button'); dis.type='button'; dis.className='ghost searchcard-dismiss'; dis.style.cssText='border:0;background:none;cursor:pointer;font-size:13px;padding:0 4px'; dis.textContent='✕'; dis.title=t('notificationDismiss')||'Dispensar';
      const body=document.createElement('div'); body.className='searchcard-body';
      const applyMin=()=>{ body.style.display=rec.minimized?'none':''; min.textContent=rec.minimized?'⌄':'⌃'; min.setAttribute('aria-expanded',String(!rec.minimized)); };
      body.innerHTML=searchCardInner(rec,true); applyMin();
      min.onclick=(e)=>{ e.stopPropagation(); rec.minimized=!rec.minimized; applyMin(); saveSearchCards(); };
      dis.onclick=(e)=>{ e.stopPropagation(); rec.dismissed=true; saveSearchCards(); d.remove(); toast(t('notificationDismissed')||'Sugestão dispensada'); };
      head.append(ttl,min,dis); d.append(head,body); return d; }
    function addSearchCard(m){ const rec={cid:uid(),query:m.query||'',answer:m.answer||'',matches:m.matches||[],action:m.action||'',ts:Date.now(),dismissed:false,minimized:false};
      if(currentSession){ const key=sessionStateKey(currentSession,currentSessionRunner); (searchCardsBySession[key]||(searchCardsBySession[key]=[])).push(rec); saveSearchCards(); }
      E.log.appendChild(buildSearchCardEl(rec)); autoScroll(); if(m.audio) playTTS(m.audio); }
    // Reinjeta os cards guardados (não dispensados) da sessão atual — chamado após montar o histórico.
    function renderStoredSearchCards(){ if(!currentSession||!E.log)return; const key=sessionStateKey(currentSession,currentSessionRunner);
      (searchCardsBySession[key]||[]).filter(r=>r&&!r.dismissed).forEach(r=>E.log.appendChild(buildSearchCardEl(r))); }
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
    let filesQuery='';  // Ctrl+F no painel de arquivos (modo 4): filtra a lista por trecho do caminho.
    function filteredFiles(){ const q=filesQuery.trim().toLowerCase(); return q ? curFiles.filter(f=>String(f.path||'').toLowerCase().includes(q)) : curFiles; }
    function renderFiles(){ E.files.innerHTML=''; secCounts();
      const _list=filteredFiles();
      _list.slice(0,filesShown).forEach(f=>{ const d=document.createElement('div'); d.className='item readable'; d.title=f.path;
        const nm=(f.path||'').split(/[\\/]/).pop()||f.path;
        const cnt=(f.action==='edit'&&(f.adds||f.dels))?` <span class="fadd">+${f.adds||0}</span> <span class="fdel">-${f.dels||0}</span>`:'';
        d.innerHTML=`<span class="rbadge">${fileActIcon(f.action)}</span><span class="rtitle">${esc(nm)}</span>${cnt}`;
        d.onclick=()=>openFile(f.path,f.action); E.files.appendChild(d); });
      if(E.filesMore){ const resta=_list.length-filesShown;
        E.filesMore.textContent = resta>0 ? `Mostrar mais (${resta})` : 'Mostrar mais';
        E.filesMore.classList.toggle('hidden', resta<=0); }
      scheduleAutoPager(maybeAutoMoreFiles); }
    function loadMoreFiles(){ const n=filteredFiles().length; if(n<=filesShown)return; filesShown=Math.min(n,filesShown+30); renderFiles(); }
    function maybeAutoMoreFiles(){ if(!E.filesPane||E.filesPane.classList.contains('hidden')||filteredFiles().length<=filesShown)return; if(nearPaneBottom(E.filesPane)||E.filesPane.scrollHeight<=E.filesPane.clientHeight+40)loadMoreFiles(); }
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
    let curFilePath='', curFileView='full', curFileDiffable=false, curFileLine=0;
    let curFileFmt=(cfg.fileFmt==='raw')?'raw':'fmt', lastFileMsg=null, curFileSig='', fileLastLoadAt=0;
    const isMdName=(n)=>/\.(md|markdown|mdx)$/i.test(n||'');
    // Markdown → HTML seguro: escapa TUDO primeiro (conteúdo do repo é não-confiável) e só então
    // aplica a marcação. Cobre títulos, negrito/itálico, código inline e em bloco (com highlight),
    // listas, citações, links, hr. Sem libs externas.
    function renderMarkdown(md){
      const esc=(s)=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
      const escA=(s)=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
      const mathSpan=(tex,disp)=>'<span class="katex-math" data-d="'+(disp?'1':'0')+'" data-tex="'+escA(tex)+'"></span>';
      const inline=(s)=>{ const M=[];
        // extrai fórmulas $...$ ANTES de escapar (o TeX fica cru); placeholders
        s=s.replace(/\$([^$\n]+?)\$/g,(m,tex)=>/^\s|\s$/.test(tex)?m:('\0'+(M.push(tex)-1)+'\0'));
        s=esc(s)
          .replace(/`([^`]+)`/g,(_,c)=>'<code>'+c+'</code>')
          .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
          .replace(/(^|[^*])\*([^*]+)\*/g,'$1<em>$2</em>')
          .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
        return s.replace(/\0(\d+)\0/g,(_,k)=>mathSpan(M[+k],false)); };
      const lines=String(md).split(/\r?\n/); let html='',i=0,inList=false,inQuote=false;
      const closeList=()=>{ if(inList){ html+='</ul>'; inList=false; } };
      const closeQuote=()=>{ if(inQuote){ html+='</blockquote>'; inQuote=false; } };
      while(i<lines.length){ let ln=lines[i];
        const fence=ln.match(/^\s*```(\w*)/);
        if(fence){ closeList(); closeQuote(); const lang=fence[1]; const buf=[]; i++;
          while(i<lines.length && !/^\s*```/.test(lines[i])){ buf.push(lines[i]); i++; } i++;
          const raw=buf.join('\n');
          if(lang==='mermaid'){ html+='<pre class="mermaid">'+esc(raw)+'</pre>'; continue; }   // diagrama (renderizado no enhanceMarkdown)
          const hl=highlight(raw, lang?('x.'+lang):'x.txt'); html+='<pre class="mdcode">'+(hl!=null?hl:esc(raw))+'</pre>'; continue; }
        // fórmula em bloco: $$ ... $$ (uma linha ou várias)
        const bm1=ln.match(/^\s*\$\$(.+?)\$\$\s*$/);
        if(bm1){ closeList(); closeQuote(); html+='<div class="katex-math" data-d="1" data-tex="'+escA(bm1[1])+'"></div>'; i++; continue; }
        if(/^\s*\$\$\s*$/.test(ln)){ closeList(); closeQuote(); const buf=[]; i++; while(i<lines.length && !/^\s*\$\$\s*$/.test(lines[i])){ buf.push(lines[i]); i++; } i++; html+='<div class="katex-math" data-d="1" data-tex="'+escA(buf.join('\n'))+'"></div>'; continue; }
        const h=ln.match(/^(#{1,6})\s+(.*)$/);
        if(h){ closeList(); closeQuote(); html+='<h'+h[1].length+'>'+inline(h[2])+'</h'+h[1].length+'>'; i++; continue; }
        if(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(ln)){ closeList(); closeQuote(); html+='<hr>'; i++; continue; }
        const q=ln.match(/^\s*>\s?(.*)$/);
        if(q){ closeList(); if(!inQuote){ html+='<blockquote>'; inQuote=true; } html+=inline(q[1])+'<br>'; i++; continue; }
        const li=ln.match(/^\s*[-*+]\s+(.*)$/)||ln.match(/^\s*\d+[.)]\s+(.*)$/);
        if(li){ closeQuote(); if(!inList){ html+='<ul>'; inList=true; } html+='<li>'+inline(li[1])+'</li>'; i++; continue; }
        // tabela GFM: linha com | seguida de uma linha separadora (---|---)
        if(ln.includes('|') && i+1<lines.length && /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(lines[i+1])){
          closeList(); closeQuote();
          const cells=(r)=>r.replace(/^\s*\|/,'').replace(/\|\s*$/,'').split('|').map(c=>c.trim());
          const head=cells(ln); i+=2;
          let t='<table class="mdtable"><thead><tr>'+head.map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr></thead><tbody>';
          while(i<lines.length && lines[i].includes('|') && lines[i].trim()){ t+='<tr>'+cells(lines[i]).map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>'; i++; }
          html+=t+'</tbody></table>'; continue;
        }
        if(!ln.trim()){ closeList(); closeQuote(); i++; continue; }
        closeQuote(); html+='<p>'+inline(ln)+'</p>'; i++;
      }
      closeList(); closeQuote(); return html;
    }
    // Libs pesadas (Mermaid ~3MB, KaTeX) são EMPACOTADAS localmente em /vendor (offline, sem CDN) e
    // carregadas SOB DEMANDA só quando um markdown tem diagrama/fórmula — não pesam no boot.
    const _asset={};
    function loadScriptOnce(src){ if(_asset[src])return _asset[src]; _asset[src]=new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s); }); return _asset[src]; }
    function loadCssOnce(href){ if(_asset[href])return; _asset[href]=1; const l=document.createElement('link'); l.rel='stylesheet'; l.href=href; document.head.appendChild(l); }
    async function enhanceMarkdown(el){
      const maths=el.querySelectorAll('.katex-math');
      if(maths.length){ loadCssOnce('/vendor/katex/katex.min.css'); try{ await loadScriptOnce('/vendor/katex/katex.min.js'); maths.forEach(m=>{ try{ window.katex.render(m.dataset.tex, m, {displayMode:m.dataset.d==='1', throwOnError:false}); }catch(e){ m.textContent=m.dataset.tex; } }); }catch(e){} }
      const mer=[...el.querySelectorAll('.mermaid')].filter(x=>!x.dataset.done);
      if(mer.length){ try{ await loadScriptOnce('/vendor/mermaid.min.js'); if(!window._mermInit){ window.mermaid.initialize({startOnLoad:false, theme:'dark', securityLevel:'strict'}); window._mermInit=true; } mer.forEach(x=>x.dataset.done='1'); await window.mermaid.run({nodes:mer}); }catch(e){ /* fica como texto do diagrama */ } }
    }
    function setWorkFileSplit(on){ const app=document.getElementById('app'); if(app)app.classList.toggle('work-file-split',!!on); }
    const APP=()=>document.getElementById('app');
    function closeFilePanel(){ E.filePanel.classList.add('hidden'); setWorkFileSplit(false); APP().classList.remove('file-full','file-open','tab-chat'); curFileSig=''; lastFileMsg=null; if(typeof findState!=='undefined'&&findState&&findState.container===E.fileBody)closeFind(); }
    function markFileOpen(){ APP().classList.add('file-open'); }
    // largura/altura persistidas do painel de arquivo (redimensionável) + modo de layout (lado a
    // lado / empilhado / abas), tudo salvo em cfg e reaplicado no reload.
    function applyFileWidth(){ if(cfg.fileW) APP().style.setProperty('--file-w', cfg.fileW+'px'); if(cfg.fileH) APP().style.setProperty('--file-h', cfg.fileH+'px'); }
    applyFileWidth();
    function applyFileLayout(mode){ mode=['side','stacked','tabs'].includes(mode)?mode:'side'; cfg.fileLayout=mode; saveCfg();
      APP().classList.remove('flay-side','flay-stacked','flay-tabs'); APP().classList.add('flay-'+mode);
      if(mode!=='tabs') APP().classList.remove('tab-chat');
      if(E.fileLayoutSw) E.fileLayoutSw.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.fl===mode)); }
    applyFileLayout(cfg.fileLayout);
    if(E.fileLayoutSw) E.fileLayoutSw.querySelectorAll('button').forEach(b=>b.onclick=()=>applyFileLayout(b.dataset.fl));
    // arraste horizontal (lado a lado) → --file-w; vertical (empilhado) → --file-h
    function fileDrag(handle,vertical){ if(!handle)return; let on=false;
      const move=(e)=>{ if(!on)return; if(vertical){ const bottom=cssPx('--safe-bottom'); const h=Math.max(120,Math.min(window.innerHeight-160-bottom, window.innerHeight-bottom-(e.clientY))); APP().style.setProperty('--file-h', h+'px'); } else { const w=Math.max(300,Math.min(window.innerWidth-260, window.innerWidth-(e.clientX))); APP().style.setProperty('--file-w', w+'px'); } };
      const up=()=>{ if(!on)return; on=false; document.body.style.userSelect=''; if(vertical){ const h=parseInt(getComputedStyle(APP()).getPropertyValue('--file-h'))||0; if(h){ cfg.fileH=h; saveCfg(); } } else { const w=parseInt(getComputedStyle(APP()).getPropertyValue('--file-w'))||0; if(w){ cfg.fileW=w; saveCfg(); } } window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up); };
      handle.addEventListener('pointerdown',(e)=>{ if(APP().classList.contains('file-full'))return; on=true; document.body.style.userSelect='none'; e.preventDefault(); window.addEventListener('pointermove',move); window.addEventListener('pointerup',up); }); }
    fileDrag(E.fileResize,false); fileDrag(E.fileResizeV,true);
    if(E.fileFull) E.fileFull.onclick=()=>APP().classList.toggle('file-full');
    if(E.tabChatBtn) E.tabChatBtn.onclick=()=>{ APP().classList.add('tab-chat'); E.tabChatBtn.classList.add('on'); E.tabFileBtn&&E.tabFileBtn.classList.remove('on'); };
    if(E.tabFileBtn) E.tabFileBtn.onclick=()=>{ APP().classList.remove('tab-chat'); E.tabFileBtn.classList.add('on'); E.tabChatBtn&&E.tabChatBtn.classList.remove('on'); };
    function fileNorm(p){ return String(p||'').replace(/\\/g,'/').replace(/\/+$/,''); }
    function fileMatchesOpen(path){ const a=fileNorm(path), b=fileNorm(curFilePath); return !!a && !!b && (a===b || a.endsWith('/'+b) || b.endsWith('/'+a)); }
    function fileSig(m){ return [m&&m.path||'', m&&m.mtimeMs!=null?m.mtimeMs:'', m&&m.size!=null?m.size:'', m&&m.truncated?'t':'', m&&m.image?'i':'', m&&m.error||''].join('|'); }
    function diffSig(m){ return [m&&m.path||'', m&&m.adds||0, m&&m.dels||0, (m&&m.rows||[]).map(r=>(r.t||'')+':'+(r.s||'')).join('\n'), m&&m.error||''].join('|'); }
    function fileOverlayCoversTree(){ return typeof matchMedia==='function' && matchMedia('(max-width:820px)').matches; }
    function openFile(path,action,opts){ if(typeof findRegion!=='undefined')findRegion='file'; const keep=!!(opts&&opts.keepWork); if(E.workPanel&&!E.workPanel.classList.contains('hidden')&&!keep)closeWorkPanel(); if(!keep&&fileOverlayCoversTree()&&E.treePanel&&!E.treePanel.classList.contains('hidden'))closeTree(); setWorkFileSplit(keep); E.filePanel.classList.remove('hidden'); markFileOpen(); APP().classList.remove('tab-chat'); if(E.tabFileBtn){E.tabFileBtn.classList.add('on');E.tabChatBtn&&E.tabChatBtn.classList.remove('on');} E.fileName.textContent=path.split(/[\\/]/).pop()||path; E.fileName.title=path;
      curFilePath=path; curFileLine=Math.max(0,Number(opts&&opts.line)||0); curFileDiffable=(action==='edit' && !!currentSession); curFileView=curFileDiffable?'diff':'full';
      renderFileViewBtns(); loadFileView(); }
    function loadFileView(opts){ const silent=!!(opts&&opts.silent); fileLastLoadAt=Date.now(); if(!silent){ curFileSig=''; E.fileStat.textContent=''; E.fileMeta.textContent=curFilePath; E.fileBody.className='filebody plain'; E.fileBody.textContent='Carregando…'; }
      if(curFileView==='diff' && curFileDiffable){ tx({t:'readdiff',sessionId:currentSession,path:curFilePath}); } else { tx({t:'readfile',path:curFilePath,cwd:curCwd}); } }
    function renderFileViewBtns(){ if(!E.fileView)return; E.fileView.classList.toggle('hidden',!curFileDiffable); // sem diff → sem toggle (só arquivo)
      E.fileView.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.v===curFileView)); }
    if(E.fileView) E.fileView.querySelectorAll('button').forEach(b=>b.onclick=()=>{ if(curFileView===b.dataset.v)return; curFileView=b.dataset.v; renderFileViewBtns(); loadFileView(); });
    setInterval(()=>{ if(!curFilePath||E.filePanel.classList.contains('hidden'))return; if(document.hidden)return; if(!ws||ws.readyState!==1)return; if(Date.now()-fileLastLoadAt<1500)return; loadFileView({silent:true}); },2500);
    function renderNativeChip(){ const c=E.nativeChip; if(!c)return; c.classList.add('hidden'); c.textContent=''; c.dataset.cmd=''; }
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
      const kw=new Set((HL_KW[lang]||HL_KW.ts).split(' '));
      if(lang==='py'||lang==='sh') return hlHash(code,kw);
      return hlJs(code,kw); }
    // Tokenizador char-a-char p/ JS/TS-like: conserta o bug do matcher por regex único, onde uma
    // aspa DENTRO de uma regex literal (ex.: str.replace(/'/g,"\\'")) começava uma "string" e engolia
    // o código até a próxima aspa, pintando tudo errado. Aqui regex literais e template `${}` são
    // reconhecidos como tokens próprios, então aspas dentro deles não desregulam mais as cores.
    const REGEX_KW=new Set('return typeof instanceof in of case do else void delete new throw yield await'.split(' '));
    function regexPos(prev){ return prev==='' || REGEX_KW.has(prev) || '([{,;=:!&|?+-*%<>~^'.includes(prev); }
    function hlHash(code,kw){ const rx=HL_RX.hash; rx.lastIndex=0; let out='',last=0,m;
      while((m=rx.exec(code))){ out+=hlEsc(code.slice(last,m.index)); last=rx.lastIndex;
        if(m[1]) out+='<span class="hl-com">'+hlEsc(m[1])+'</span>';
        else if(m[2]) out+='<span class="hl-str">'+hlEsc(m[2])+'</span>';
        else if(m[3]) out+='<span class="hl-num">'+hlEsc(m[3])+'</span>';
        else { const w=m[4]; out+= kw.has(w)?'<span class="hl-kw">'+w+'</span>' : HL_LIT.has(w)?'<span class="hl-lit">'+w+'</span>' : /^[A-Z]/.test(w)?'<span class="hl-type">'+w+'</span>' : code[rx.lastIndex]==='('?'<span class="hl-fn">'+w+'</span>':hlEsc(w); } }
      return out+hlEsc(code.slice(last)); }
    function hlJs(code,kw){ let out='',i=0; const n=code.length; let prev='';
      const push=(cls,txt)=>{ out+= cls?('<span class="'+cls+'">'+hlEsc(txt)+'</span>'):hlEsc(txt); };
      while(i<n){ const c=code[i];
        if(c===' '||c==='\t'||c==='\n'||c==='\r'){ let j=i+1; while(j<n&&/\s/.test(code[j]))j++; out+=hlEsc(code.slice(i,j)); i=j; continue; }
        if(c==='/'&&code[i+1]==='/'){ let j=i+2; while(j<n&&code[j]!=='\n')j++; push('hl-com',code.slice(i,j)); i=j; continue; }
        if(c==='/'&&code[i+1]==='*'){ let j=code.indexOf('*/',i+2); j=j<0?n:j+2; push('hl-com',code.slice(i,j)); i=j; continue; }
        if(c==='"'||c==="'"){ let j=i+1; while(j<n){ if(code[j]==='\\'){j+=2;continue;} if(code[j]===c){j++;break;} if(code[j]==='\n')break; j++; } push('hl-str',code.slice(i,j)); i=j; prev=c; continue; }
        if(c==='`'){ let j=i+1; while(j<n){ if(code[j]==='\\'){j+=2;continue;} if(code[j]==='`'){j++;break;} j++; } push('hl-str',code.slice(i,j)); i=j; prev='`'; continue; }
        if(c==='/'&&regexPos(prev)){ let j=i+1,ok=false,cls=false; while(j<n){ const d=code[j]; if(d==='\\'){j+=2;continue;} if(d==='\n')break; if(d==='[')cls=true; else if(d===']')cls=false; else if(d==='/'&&!cls){ j++; ok=true; break; } j++; }
          if(ok){ while(j<n&&/[a-z]/i.test(code[j]))j++; push('hl-str',code.slice(i,j)); i=j; prev='/'; continue; } }
        if(/[0-9]/.test(c)||(c==='.'&&/[0-9]/.test(code[i+1]||''))){ let j=i+1; while(j<n&&/[\w.]/.test(code[j]))j++; push('hl-num',code.slice(i,j)); i=j; prev='0'; continue; }
        if(/[A-Za-z_$]/.test(c)){ let j=i+1; while(j<n&&/[\w$]/.test(code[j]))j++; const w=code.slice(i,j); let cls=null;
          if(kw.has(w))cls='hl-kw'; else if(HL_LIT.has(w))cls='hl-lit'; else if(/^[A-Z]/.test(w))cls='hl-type'; else { let k=j; while(k<n&&/\s/.test(code[k]))k++; if(code[k]==='(')cls='hl-fn'; }
          push(cls,w); i=j; prev=REGEX_KW.has(w)?w:'w'; continue; }
        out+=hlEsc(c); if(!/\s/.test(c))prev=c; i++; }
      return out; }
    function showFile(m,opts){ if(E.filePanel.classList.contains('hidden')||!fileMatchesOpen(m.path))return; const sig=fileSig(m); if(!(opts&&opts.force)&&sig&&sig===curFileSig)return; curFileSig=sig; curFilePath=m.path||curFilePath; E.fileName.textContent=m.name||(m.path||'').split(/[\\/]/).pop()||'arquivo'; E.fileName.title=m.path||''; E.fileStat.textContent=''; E.fileBody.className='filebody plain';
      if(m.error){ E.fileMeta.textContent=m.path||''; E.fileBody.textContent='⚠ '+m.error; return; }
      const kb=m.size?(m.size<1024?m.size+' B':(m.size/1024).toFixed(1)+' KB'):''; E.fileMeta.textContent=(m.path||'')+(kb?' · '+kb:'')+(m.truncated?' · (primeiros 512KB)':'');
      if(m.image&&m.content){ const src='data:'+(m.mime||'image/*')+';base64,'+m.content; E.fileBody.className='filebody plain'; E.fileBody.innerHTML='';
        lastFileMsg=m; const im=document.createElement('img'); im.src=src; im.alt=m.name||''; im.style.cssText='max-width:100%;height:auto;border-radius:8px;cursor:zoom-in;display:block'; im.onclick=()=>openImg(src); E.fileBody.appendChild(im); E.fileBody.scrollTop=0; return; }
      lastFileMsg=m; const nm=m.name||m.path||'', content=m.content||'', md=isMdName(nm), canHl=hlLang(nm)!=null;
      // toggle Formatado/Bruto aparece para .md (renderiza markdown) e para código (liga/desliga cores)
      if(E.fileFmt){ E.fileFmt.classList.toggle('hidden', !(md||canHl)); renderFileFmtBtns(); }
      if(md && curFileFmt==='fmt'){ E.fileBody.className='filebody mdview'; E.fileBody.innerHTML=renderMarkdown(content); enhanceMarkdown(E.fileBody); annoTeardown(); }
      else { renderFileLines(content, nm, curFileFmt==='fmt' && canHl, m.path||nm); }
      E.fileBody.scrollTop=0; }
    function renderFileFmtBtns(){ if(!E.fileFmt)return; E.fileFmt.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.f===curFileFmt)); }
    if(E.fileFmt) E.fileFmt.querySelectorAll('button').forEach(b=>b.onclick=()=>{ if(curFileFmt===b.dataset.f)return; curFileFmt=b.dataset.f; cfg.fileFmt=curFileFmt; saveCfg(); renderFileFmtBtns(); if(lastFileMsg) showFile(lastFileMsg,{force:true}); });
    function showDiff(m){ if(E.filePanel.classList.contains('hidden')||!fileMatchesOpen(m.path))return; const sig=diffSig(m); if(sig&&sig===curFileSig)return; curFileSig=sig; curFilePath=m.path||curFilePath; E.fileName.textContent=m.name||(m.path||'').split(/[\\/]/).pop()||'arquivo'; E.fileName.title=m.path||''; E.fileMeta.textContent=m.path||'';
      if(m.error){ E.fileStat.textContent=''; E.fileBody.className='filebody plain'; E.fileBody.textContent='⚠ '+m.error; return; }
      E.fileStat.innerHTML=`<span class="add">+${m.adds||0}</span> <span class="del">-${m.dels||0}</span>`;
      E.fileBody.className='filebody lines'; E.fileBody.innerHTML='';
      const frag=document.createDocumentFragment();
      (m.rows||[]).forEach((r,idx)=>{ const ln=idx+1; const cls=r.t==='+'?'add':r.t==='-'?'del':r.t==='@'?'sec':'ctx';
        const row=document.createElement('div'); row.className='frow d-'+cls; row.dataset.ln=ln;
        const g=document.createElement('span'); g.className='fgutter'; g.textContent=(r.t==='+'||r.t==='-')?r.t:(r.t==='@'?'@':ln);
        const c=document.createElement('span'); c.className='fcontent'; c.textContent=r.s;
        row.append(g,c); frag.appendChild(row); });
      E.fileBody.appendChild(frag);
      annoSetup('diff', (m.path||'')+' (diff)'); E.fileBody.scrollTop=0; scrollFileLine(); }

    // ---------- comentários/anotações no arquivo ou diff (Orca "Annotate AI Diffs" — Opção A) ----------
    // Ancora notas a uma linha ou faixa de linhas; junta várias e envia tudo para a IA escolhida.
    // Persistido por arquivo em localStorage (some junto quando o usuário limpa). Trecho vai junto
    // para a IA ter o contexto exato mesmo sem números de linha do diff.
    let annos=[], annoSel=null, curAnnoView='file', annoPath='';
    function annoKey(p){ return 'jarvis_anno:'+p; }
    function annoLoad(){ try{ annos=JSON.parse(localStorage.getItem(annoKey(annoPath))||'[]'); }catch(e){ annos=[]; } }
    function annoSave(){ try{ if(annos.length) localStorage.setItem(annoKey(annoPath), JSON.stringify(annos)); else localStorage.removeItem(annoKey(annoPath)); }catch(e){} }
    function renderFileLines(content, name, useHl, path){
      E.fileBody.className='filebody lines'; E.fileBody.innerHTML='';
      const lines=String(content).split('\n'); const frag=document.createDocumentFragment();
      lines.forEach((line,idx)=>{ const ln=idx+1;
        const row=document.createElement('div'); row.className='frow'; row.dataset.ln=ln;
        const g=document.createElement('span'); g.className='fgutter'; g.textContent=ln;
        const c=document.createElement('span'); c.className='fcontent';
        const hl=useHl?highlight(line,name):null; if(hl!=null&&hl!=='') c.innerHTML=hl; else c.textContent=line;
        row.append(g,c); frag.appendChild(row); });
      E.fileBody.appendChild(frag);
      annoSetup('file', path||name); scrollFileLine();
    }
    function scrollFileLine(){ if(!curFileLine)return; requestAnimationFrame(()=>{ const row=E.fileBody.querySelector('.frow[data-ln="'+curFileLine+'"]'); if(!row)return; row.classList.add('selrange'); row.scrollIntoView({block:'center'}); }); }
    function annoSetup(view, path){ curAnnoView=view; if(annoPath!==path){ annoPath=path; annoLoad(); } annoSel=null; annoBarHide(); annoRenderNotes(); }
    function annoTeardown(){ annoSel=null; annoBarHide(); if(E.annoSend)E.annoSend.classList.add('hidden'); }
    function annoRows(){ return E.fileBody.querySelectorAll('.frow'); }
    function annoPick(ln){ if(!annoSel) annoSel={from:ln,to:ln}; else annoSel={from:Math.min(annoSel.from,ln),to:Math.max(annoSel.to,ln)}; annoPaint(); }
    function annoLabel(a){ if(!a)return ''; return a.from===a.to?('Linha '+a.from):('Linhas '+a.from+'–'+a.to); }
    function annoPaint(){ annoRows().forEach(r=>{ const n=+r.dataset.ln; r.classList.toggle('selrange', !!annoSel && n>=annoSel.from && n<=annoSel.to); });
      if(annoSel){ E.annoSelLbl.textContent = annoLabel(annoSel); E.annoBar.classList.add('on'); } else annoBarHide(); }
    function annoBarHide(){ if(E.annoBar)E.annoBar.classList.remove('on'); }
    function annoSnippet(from,to){ const out=[]; annoRows().forEach(r=>{ const n=+r.dataset.ln; if(n>=from&&n<=to){ const c=r.querySelector('.fcontent'); out.push(c?c.textContent:''); } }); return out.join('\n'); }
    async function annoAddCurrent(){ if(!annoSel)return; const from=annoSel.from,to=annoSel.to;
      const text=await dialog({title:'💬 Comentar '+annoLabel(annoSel).toLowerCase(),input:true,placeholder:'Escreva seu comentário para a IA…',okText:'Adicionar'});
      if(!text)return; annos.push({from,to,snippet:annoSel.snippet||annoSnippet(from,to),text}); annoSave(); annoSel=null; annoPaint(); annoRenderNotes(); }
    function annoRenderNotes(){ E.fileBody.querySelectorAll('.anno-note').forEach(x=>x.remove());
      annos.forEach((a,i)=>{ const anchor=[...annoRows()].find(r=>+r.dataset.ln===a.to); if(!anchor)return;
        const nt=document.createElement('div'); nt.className='anno-note';
        nt.innerHTML='<span class="an-x" title="Remover">✕</span><div class="an-h">NOTA · '+annoLabel(a).toUpperCase()+'</div><div class="an-t"></div>';
        nt.querySelector('.an-t').textContent=a.text; nt.querySelector('.an-x').onclick=()=>{ annos.splice(i,1); annoSave(); annoRenderNotes(); };
        anchor.after(nt); });
      const n=annos.length; if(E.annoSend){ E.annoSend.classList.toggle('hidden', n===0); if(E.annoCount)E.annoCount.textContent=n; } }
    function annoLineFromNode(node){ const el=node&&node.nodeType===1?node:node&&node.parentElement; const row=el&&el.closest?el.closest('.frow'):null; return row?+row.dataset.ln:0; }
    function annoCaptureNativeSelection(){ const sel=window.getSelection&&window.getSelection(); if(!sel||sel.isCollapsed||!sel.rangeCount)return; const txt=sel.toString().trim(); if(!txt)return;
      const range=sel.getRangeAt(0); if(!E.fileBody.contains(range.commonAncestorContainer))return;
      const a=annoLineFromNode(range.startContainer), b=annoLineFromNode(range.endContainer); if(!a||!b)return;
      annoSel={from:Math.min(a,b),to:Math.max(a,b),snippet:txt}; annoPaint(); }
    let annoNativeT=null;
    document.addEventListener('selectionchange',()=>{ clearTimeout(annoNativeT); annoNativeT=setTimeout(annoCaptureNativeSelection,120); });
    E.fileBody.addEventListener('mouseup',()=>setTimeout(annoCaptureNativeSelection,0));
    E.fileBody.addEventListener('touchend',()=>setTimeout(annoCaptureNativeSelection,180),{passive:true});
    // seleção por TEXTO nativo ou por CLIQUE (início→fim em dois cliques) no gutter.
    // Delegação em E.fileBody (uma vez) — sobrevive ao re-render das linhas.
    (function(){ let dragging=false, moved=false, anchor=0;
      const lnAt=(e)=>{ const el=document.elementFromPoint(e.clientX,e.clientY); const row=el&&el.closest?el.closest('.frow'):null; return row?+row.dataset.ln:0; };
      E.fileBody.addEventListener('pointerdown',(e)=>{ const g=e.target.closest?e.target.closest('.fgutter'):null; if(!g)return; const row=g.closest('.frow'); if(!row)return; e.preventDefault(); dragging=true; moved=false; anchor=+row.dataset.ln; });
      E.fileBody.addEventListener('pointermove',(e)=>{ if(!dragging)return; const ln=lnAt(e); if(!ln)return; if(!moved){ moved=true; document.body.style.userSelect='none'; } annoSel={from:Math.min(anchor,ln),to:Math.max(anchor,ln)}; annoPaint(); });
      const end=()=>{ if(!dragging)return; dragging=false; document.body.style.userSelect=''; if(!moved) annoPick(anchor); }; // sem arrastar = clique (início→fim em 2 cliques)
      E.fileBody.addEventListener('pointerup',end); E.fileBody.addEventListener('pointercancel',end);
    })();
    if(E.annoAdd) E.annoAdd.onclick=annoAddCurrent;
    if(E.annoCancelSel) E.annoCancelSel.onclick=()=>{ annoSel=null; annoPaint(); };
    if(E.annoSend) E.annoSend.onclick=()=>annoSendPop();
    // envia todos os comentários para a IA ESCOLHIDA (pop com as IAs disponíveis)
    function annoSendPop(){ if(!annos.length)return; if(!currentSession){ toast('Abra uma conversa primeiro.'); return; }
      openPop(E.annoSend,(p)=>{ p.appendChild(ph('Enviar comentários para')); const caps=machineCaps().filter(c=>machineAgents().includes(c.name));
        (caps.length?caps:[{name:currentAgent||'jarvis',label:'Sessão atual'}]).forEach(c=>{ const o=document.createElement('div'); o.className='opt'; o.textContent='🤖 '+(c.label||c.name); o.onclick=()=>{ closePop(); annoDispatch(c.name); }; p.appendChild(o); }); }); }
    function annoDispatch(agent){ const path=annoPath.replace(/ \(diff\)$/,'');
      let msg='Revise e aplique os comentários abaixo no arquivo `'+path+'`:\n\n';
      annos.forEach((a,i)=>{ msg+='### Comentário '+(i+1)+' — '+(a.from===a.to?('linha '+a.from):('linhas '+a.from+'–'+a.to))+'\n```\n'+a.snippet+'\n```\n'+a.text+'\n\n'; });
      msg+='Aplique os ajustes conforme os comentários acima.';
      if(agent && agent!==currentAgent && !curStarted && !curNative){ tx({t:'configure',sessionId:currentSession,agent}); }
      sendMsgTo(currentSession, msg);
      annos=[]; annoSave(); annoRenderNotes(); toast('✈️ Comentários enviados para a IA.'); }

    // Ao enviar, a sessão vira a MAIS RECENTE → sobe pro topo do menu na hora (o servidor confirma depois).
    let lastBump=null;
    // ---------- organização da lista de conversas (agrupar / ordenar / filtrar) ----------
    // Prefs persistidas: como o Histórico é agrupado, ordenado e filtrado. Espelha o padrão dos
    // três prints do usuário (lista tipo Claude Code, com projetos como cabeçalhos).
    const REC_GROUPS=['project','machine','agent','date','none'], REC_SORTS=['recency','alpha','cost'], REC_STATUS=['active','archived','all'];
    const recGroupLabels={project:'Projeto',machine:'Máquina',agent:'Agente',date:'Data',none:'Nenhum'};
    const recSortLabels={recency:'Recentes',alpha:'Alfabética',cost:'Custo'};
    const recStatusLabels={active:'Ativas',archived:'Arquivadas',all:'Todas'};
    let recPrefs=Object.assign({groupBy:'project',sortBy:'recency',status:'active'},(()=>{try{return JSON.parse(localStorage.getItem('jarvis_recents_prefs')||'{}');}catch(e){return{};}})());
    if(!REC_GROUPS.includes(recPrefs.groupBy))recPrefs.groupBy='project';
    if(!REC_SORTS.includes(recPrefs.sortBy))recPrefs.sortBy='recency';
    if(!REC_STATUS.includes(recPrefs.status))recPrefs.status='active';
    function saveRecPrefs(){ try{ localStorage.setItem('jarvis_recents_prefs',JSON.stringify(recPrefs)); }catch(e){} }
    let recFilteredTotal=0; // total após filtro de status (paginação "Mostrar mais" usa isto, não sessions.length)
    // Grupos recolhidos (clicar no nome do grupo alterna). Persistido por (modo de agrupamento + chave).
    let recCollapsed=new Set((()=>{try{return JSON.parse(localStorage.getItem('jarvis_recents_collapsed')||'[]');}catch(e){return[];}})());
    function saveRecCollapsed(){ try{ localStorage.setItem('jarvis_recents_collapsed',JSON.stringify([...recCollapsed])); }catch(e){} }
    function groupCollapseKey(groupBy,key){ return groupBy+' '+key; }
    // Cada grupo (projeto/máquina/agente/data) mostra no máximo REC_GROUP_PAGE itens; o resto fica atrás
    // de um "ver mais" centralizado por grupo. `recGroupExpanded` guarda quais grupos foram expandidos
    // (em memória — reabrir a lista volta ao teto de 7, comportamento esperado de "ver mais").
    const REC_GROUP_PAGE=7;
    let recGroupExpanded=new Set();
    // Último segmento do caminho de trabalho — o "nome do projeto" que vira cabeçalho de grupo.
    function projectLabelOf(cwd){ if(!cwd)return 'Sem pasta'; const parts=String(cwd).split(/[\\/]+/).filter(Boolean); return parts.length?parts[parts.length-1]:String(cwd); }
    function dateBucketOf(ts,now){ if(!ts)return 'Sem data'; const day=86400000, a=new Date(now), b=new Date(ts); const midnight=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime(); const diff=midnight(a)-midnight(b); if(diff<=0)return 'Hoje'; if(diff<=day)return 'Ontem'; if(diff<7*day)return 'Últimos 7 dias'; if(diff<30*day)return 'Últimos 30 dias'; return 'Mais antigas'; }
    function recGroupKey(s,groupBy,now){ if(groupBy==='machine')return 'm:'+(s.machine||s.runnerId||'local'); if(groupBy==='agent')return 'a:'+(s.agent||'—'); if(groupBy==='date')return 'd:'+dateBucketOf(s.updatedAt||0,now); if(groupBy==='none')return ''; return 'p:'+projectLabelOf(s.cwd); }
    function recGroupLabel(s,groupBy,now){ if(groupBy==='machine')return s.machine||'Local'; if(groupBy==='agent')return s.agent||'—'; if(groupBy==='date')return dateBucketOf(s.updatedAt||0,now); if(groupBy==='none')return ''; return projectLabelOf(s.cwd); }
    // PURA e testável: aplica filtro de status → ordenação → recorte (limit) → agrupamento,
    // preservando a ordem ordenada dentro de cada grupo e a ordem de aparição entre grupos.
    function organizeSessions(list,opts){ opts=opts||{}; const groupBy=REC_GROUPS.includes(opts.groupBy)?opts.groupBy:'project', sortBy=REC_SORTS.includes(opts.sortBy)?opts.sortBy:'recency', status=REC_STATUS.includes(opts.status)?opts.status:'active'; const now=opts.now||Date.now();
      const grouped=groupBy!=='none', expanded=opts.expanded||new Set();
      // Agrupado: sem teto global — pega TODAS e aplica o teto POR grupo (7 + "ver mais"). Sem agrupamento:
      // mantém o teto global antigo (`limit`) com o "Mostrar mais" único no rodapé da lista.
      const perGroup=grouped?(opts.perGroupLimit==null?REC_GROUP_PAGE:opts.perGroupLimit):Infinity;
      const globalLimit=grouped?Infinity:(opts.limit==null?Infinity:opts.limit);
      const filtered=(list||[]).filter(s=> status==='all'?true : status==='archived'?!!s.archived : !s.archived );
      const rank={recency:(a,b)=>(b.updatedAt||0)-(a.updatedAt||0), alpha:(a,b)=>String(a.title||'').localeCompare(String(b.title||''),undefined,{sensitivity:'base'}), cost:(a,b)=>(b.cost||0)-(a.cost||0)||(b.updatedAt||0)-(a.updatedAt||0)}[sortBy];
      const sorted=rank?filtered.slice().sort(rank):filtered.slice();
      const visible=sorted.slice(0,globalLimit); const groups=[]; const idx=new Map();
      for(const s of visible){ const key=recGroupKey(s,groupBy,now); let g=idx.get(key); if(!g){ g={key,label:recGroupLabel(s,groupBy,now),cwd:s.cwd||'',runnerId:s.runnerId||'local',machine:s.machine||'',all:[]}; idx.set(key,g); groups.push(g); } g.all.push(s); }
      let shownCount=0;
      for(const g of groups){ g.total=g.all.length; const isExp=expanded.has(groupCollapseKey(groupBy,g.key));
        g.sessions=(grouped&&!isExp)?g.all.slice(0,perGroup):g.all; g.hidden=g.total-g.sessions.length; g.expanded=isExp; shownCount+=g.sessions.length; }
      return {groups,total:filtered.length,shownCount,groupBy,sortBy,status}; }

    function bumpSession(sid){ if(!sid)return; const runner=sessionRunner(); lastBump={sid,runner,ts:Date.now()}; const i=sessions.findIndex(s=>s.id===sid&&(currentMachine!=='all'||(s.runnerId||'local')===runner)); if(i>0){ const [s]=sessions.splice(i,1); sessions.unshift(s); renderRecents(); } }
    // Menu "⋯" de ações da conversa (Resumir / Arquivar / Remover) — junta os botões antes soltos na
    // linha, liberando espaço. `anchor` é o botão ⋯ (leva o estado ⏳ do resumo mesmo após fechar o menu).
    function buildRowMenu(p,s,anchor,runner,nat){ p.appendChild(ph(s.title||'Sessão'));
      const item=(icon,label,danger,fn)=>{ const o=document.createElement('div'); o.className='opt'+(danger?' danger':''); o.innerHTML='<span class="aiico">'+icon+'</span> '+esc(label); o.onclick=(e)=>{ e.preventDefault(); e.stopPropagation(); fn(); }; p.appendChild(o); };
      item('🔊','Resumir e falar',false,()=>{ closePop(); if(!startVoiceOp('summarize',anchor,'⏳',s.id))return; status('speaking',t('stSummarizing')); tx({t:'summarize',sessionId:s.id,speak:true}); });
      if(!nat) item(s.archived?'📤':'📥', s.archived?'Desarquivar':'Arquivar', false, ()=>{ closePop(); tx({t:'archive',sessionId:s.id,archived:!s.archived}); toast(s.archived?'Desarquivando…':'Arquivando…'); });
      item('🗑','Remover',true,async()=>{ closePop(); const ia=(s.agent==='codex')?'codex':'claude';
        const ok=await dialog({title:`Remover "${s.title||'conversa'}"? Apaga no Jarvis e a sessão no ${ia} — não dá pra desfazer.`, okText:'Remover', danger:true});
        if(!ok) return; tx({t:'delete',sessionId:s.id,alsoNative:true}); toast('Removendo…'); }); }
    // Monta o item (linha ÚNICA) de UMA conversa — extraído para o render agrupado reaproveitar.
    function renderRecentRow(s){ const runner=s.runnerId||selectedRunner(), run=(activeRunsByRunner[runner]||[]).includes(s.id), un=unread.has(sessionStateKey(s.id,runner))&&!run&&!(s.id===currentSession&&runner===currentSessionRunner);
      const d=document.createElement('div'); d.className='item'+(s.id===currentSession&&runner===currentSessionRunner?' active':'')+(run?' running':'')+(un?' unread':'')+(s.archived?' archived':'');
      const nat=isNative(s.id);
      // "nativo" NÃO vai mais na listagem (encurtava o nome da sessão); a marca de nativo continua no tooltip (title) do item.
      const mb=(currentMachine==='all'&&s.machine)?`<span class="rmachine" style="--mh:${machineHue(s.machine)}" title="Máquina: ${esc(s.machine)}">${esc(s.machine)}</span>`:'';
      const personalHint=personalTurnSuggestions&&personalTurnSuggestions.has(sessionStateKey(s.id,runner));
      d.innerHTML=`<span class="rdot"></span><span class="rbadge" title="${esc(s.agent||'')}">${agentIcon(s.agent)}</span><span class="rtitle">${esc(s.title||'Sessão')}</span>${personalHint?`<span class="rpersonal" title="${esc(t('personalSuggestionsAvailable'))}">⌖</span>`:''}${mb}`;
      const more=document.createElement('button'); more.type='button'; more.className='rmore'; more.title='Ações'; more.textContent='⋯';
      const busySum=voiceOp==='summarize'&&voiceOpSid===s.id; if(busySum){ more.textContent='⏳'; more.classList.add('busy'); voiceOpBtn=more; }
      more.onclick=(e)=>{ e.stopPropagation(); openPop(more,(p)=>buildRowMenu(p,s,more,runner,nat)); };
      d.appendChild(more);
      d.title=`${s.title||'Sessão'}\n— ${s.agent||''}${nat?' · nativo':''}${s.archived?' · arquivada':''}\n${s.cwd||''}`;
      d.onclick=()=>{ openSession(s.id,runner); closeSide(); };
      return d; }
    // Cabeçalho de grupo (Projeto/Máquina/Agente/Data): chevron + nome + contagem + "+". Clicar no
    // cabeçalho recolhe/expande o grupo (o chevron aparece no hover; ▾ recolhido = "abrir", ▴ = "fechar").
    function renderGroupHeader(g,groupBy){ const h=document.createElement('div'); h.className='rgroup';
      const ck=groupCollapseKey(groupBy,g.key), collapsed=recCollapsed.has(ck); if(collapsed) h.classList.add('collapsed');
      const chev=document.createElement('span'); chev.className='rgchev'; h.appendChild(chev); // direção vem da classe .collapsed (triângulo CSS)
      const lbl=document.createElement('span'); lbl.className='rglabel'; lbl.textContent=g.label; h.appendChild(lbl);
      const cnt=document.createElement('span'); cnt.className='rgcnt'; cnt.textContent=String(g.total!=null?g.total:g.sessions.length); h.appendChild(cnt);
      // "+" só faz sentido quando o grupo carrega um destino concreto: projeto (pasta) ou máquina.
      if(groupBy==='project'||groupBy==='machine'){ const add=document.createElement('button'); add.type='button'; add.className='rgnew'; add.textContent='＋';
        add.title=groupBy==='project'?('Nova sessão em '+(g.cwd||g.label)):('Nova sessão em '+(g.machine||g.label));
        add.onclick=(e)=>{ e.stopPropagation(); if(groupBy==='project') startNewSession({target:g.runnerId,cwd:g.cwd}); else startNewSession({target:g.runnerId}); };
        h.appendChild(add); }
      h.title=(collapsed?'Expandir':'Recolher')+' · '+(groupBy==='project'?(g.cwd||g.label):g.label);
      h.onclick=()=>{ if(recCollapsed.has(ck)) recCollapsed.delete(ck); else recCollapsed.add(ck); saveRecCollapsed(); renderRecents(); };
      return h; }
    // "ver mais / ver menos" centralizado no rodapé de um grupo que passa do teto de 7.
    function renderGroupMore(g,groupBy){ const gk=groupCollapseKey(groupBy,g.key);
      const row=document.createElement('div'); row.className='rgmore-row'; row.style.cssText='display:flex;justify-content:center;padding:2px 8px 8px';
      const b=document.createElement('button'); b.type='button'; b.className='rgmore ghost'; b.style.cssText='background:none;border:0;color:var(--accent,#6ea8fe);cursor:pointer;font-size:12px;padding:4px 12px;border-radius:6px;opacity:.9';
      b.textContent=g.expanded?'ver menos':('ver mais ('+g.hidden+')'); b.setAttribute('aria-expanded',String(!!g.expanded));
      b.onclick=(e)=>{ e.stopPropagation(); if(recGroupExpanded.has(gk)) recGroupExpanded.delete(gk); else recGroupExpanded.add(gk); renderRecents(); };
      row.appendChild(b); return row; }
    function renderRecents(){ E.recents.innerHTML='';
      const visibleRuns=currentMachine==='all'?sessions.filter(s=>(activeRunsByRunner[s.runnerId||'local']||[]).includes(s.id)).length:activeRuns.length;
      if(visibleRuns){ const h=document.createElement('div'); h.className='runhdr'; h.textContent='▶ '+visibleRuns+' rodando agora'; E.recents.appendChild(h); }
      // Visão unificada incompleta: diz QUAIS máquinas ficaram de fora, em vez de só mostrar menos itens.
      if(currentMachine==='all'){ const missing=allViewMachines.filter(x=>x&&!x.contributed);
        if(missing.length){ const w=document.createElement('div'); w.className='runhdr partial';
          w.textContent='⚠ sem '+missing.map(x=>x.label+(x.online?' (não respondeu)':' (offline)')).join(', ');
          w.title='A lista abaixo não inclui as sessões dessas máquinas.'; E.recents.appendChild(w); } }
      secCounts();
      if(E.recOptsLabel) E.recOptsLabel.textContent=(recGroupLabels[recPrefs.groupBy]||'—')+(recPrefs.status!=='active'?(' · '+recStatusLabels[recPrefs.status]):'');
      const org=organizeSessions(sessions,{groupBy:recPrefs.groupBy,sortBy:recPrefs.sortBy,status:recPrefs.status,limit:shown,perGroupLimit:REC_GROUP_PAGE,expanded:recGroupExpanded});
      recFilteredTotal=org.total;
      if(!org.shownCount){ const empty=document.createElement('div'); empty.className='mut'; empty.style.cssText='padding:14px 8px;font-size:12.5px'; empty.textContent=recPrefs.status==='archived'?'Nenhuma conversa arquivada.':'Nenhuma conversa.'; E.recents.appendChild(empty); }
      org.groups.forEach(g=>{ if(org.groupBy!=='none'){ E.recents.appendChild(renderGroupHeader(g,org.groupBy)); if(recCollapsed.has(groupCollapseKey(org.groupBy,g.key))) return; }
        g.sessions.forEach(s=>E.recents.appendChild(renderRecentRow(s)));
        if(org.groupBy!=='none' && g.total>REC_GROUP_PAGE) E.recents.appendChild(renderGroupMore(g,org.groupBy)); });
      // Agrupado: paginação é POR grupo (ver mais/menos). Sem agrupamento: mantém o "Mostrar mais" global.
      const paged=org.groupBy==='none';
      E.moreBtn.classList.toggle('hidden', !paged || org.total<=shown); if(paged) scheduleAutoPager(maybeAutoMoreRecents); }
    function loadMoreRecents(){ if(recFilteredTotal<=shown)return; shown=Math.min(recFilteredTotal,shown+20); renderRecents(); }
    function maybeAutoMoreRecents(){ if(recPrefs.groupBy!=='none')return; if(!E.recPane||E.recPane.classList.contains('hidden')||recFilteredTotal<=shown)return; if(nearPaneBottom(E.recPane)||E.recPane.scrollHeight<=E.recPane.clientHeight+40)loadMoreRecents(); }
    E.moreBtn.onclick=loadMoreRecents;
    if(E.recPane)E.recPane.addEventListener('scroll',maybeAutoMoreRecents);
    // Popover de opções da lista: Agrupar / Ordenar / Status. Cada escolha persiste e re-renderiza.
    function buildRecOptsPop(p){ p.appendChild(ph('Organizar conversas'));
      const seg=(title,options,labels,cur,pick)=>{ p.appendChild(ph(title)); const row=document.createElement('div'); row.className='optseg';
        options.forEach(opt=>{ const b=document.createElement('button'); b.type='button'; b.className='seg'+(opt===cur?' on':''); b.textContent=labels[opt]||opt; b.onclick=()=>{ pick(opt); saveRecPrefs(); shown=Math.max(shown,16); renderRecents(); replaceOpenPop(E.recOptsBtn,buildRecOptsPop); }; row.appendChild(b); });
        p.appendChild(row); };
      seg('Agrupar por',REC_GROUPS,recGroupLabels,recPrefs.groupBy,v=>recPrefs.groupBy=v);
      seg('Ordenar por',REC_SORTS,recSortLabels,recPrefs.sortBy,v=>recPrefs.sortBy=v);
      seg('Mostrar',REC_STATUS,recStatusLabels,recPrefs.status,v=>recPrefs.status=v); }
    if(E.recOptsBtn) E.recOptsBtn.onclick=()=>togglePop(E.recOptsBtn,buildRecOptsPop);

    // ---------- seletor de máquina (runners) ----------
    function renderMachines(){
      if(!E.machineBar) return;
      if(machines.length<=1){ E.machineBar.style.display='none'; return; }
      // Máquina salva que não existe mais (revogada/renomeada): cai pra 'local' E apaga a preferência.
      // Antes só o `currentMachine` era corrigido aqui — e como este render roda ANTES do bloco de
      // restauração, aquele bloco já encontrava 'local' na lista e nunca chegava a limpar o storage.
      // O id morto sobrevivia a todo reload, reabrindo a janela de divergência cliente⇄Hub a cada boot.
      if(currentMachine!=='all' && !machines.some(m=>m.id===currentMachine)){ currentMachine='local'; try{localStorage.removeItem('jarvis_machine');}catch{} }
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
        const bTitle = 'Build: '+(m.build||m.commit||'?')+((m.hubBuild||m.hubCommit)?' · servidor: '+(m.hubBuild||m.hubCommit):'');
        const ver = (m.build||m.commit) ? '<span class="mver" title="'+esc(bTitle)+'">'+fmtBuild(m.build,m.commit)+'</span>' : '';
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
      currentMachine=id; restoringMachine=false; openingSession=null; try{localStorage.setItem('jarvis_machine',id);}catch{} currentSession=null; currentSessionRunner=id==='all'?(routedMachine||'local'):id; activeRuns=activeRunsByRunner[currentSessionRunner]||[]; curStarted=false; attachments=[]; renderAttach(); clearQueue(); E.log.innerHTML=''; E.title.textContent='—'; refreshTitleInfo(); curNativeId=''; renderNativeChip(); setHash(''); renderMachines();
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
    let curModel=null, curEffort=null, curCwd='', curStarted=false, curMode=null;
    // Durable session-defaults config (mirrors ~/.jarvis/session-defaults.json on the Hub); the "no
    // session open" mode pick edits its global default, matching the model/effort "vira padrão" UX.
    let sdDoc={global:{},projects:[]};
    const MODE_LABELS={manual:'Manual',accept_edits:'Aceitar edições',plan:'Planejar',auto:'Automático',bypass:'Ignorar permissões'};
    const MODE_DESC={manual:'Sempre perguntar antes de fazer alterações',accept_edits:'Aceitar automaticamente todas as edições',plan:'Criar um plano antes de fazer alterações',auto:'A IA gerencia decisões de permissão',bypass:'Aceita todas as permissões'};
    const modeLabel=m=>m?(MODE_LABELS[m]||m):'Padrão';
    function supportedModesFor(agent){ const cap=(caps||[]).find(c=>c.name===agent); return (cap&&cap.capabilities&&cap.capabilities.supportedPermissionModes)||['bypass']; }
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
    // Cards de sugestão (busca cross-sessão): guardados POR sessão pra não sumirem ao navegar/recarregar.
    // Chave = sessionStateKey da sessão onde apareceram. Cap global pra não crescer sem limite no storage.
    let searchCardsBySession={}; try{ const raw=JSON.parse(localStorage.getItem('jarvis_search_cards')||'{}'); if(raw&&typeof raw==='object') searchCardsBySession=raw; }catch(e){}
    function saveSearchCards(){ try{
      const all=[];
      for(const k of Object.keys(searchCardsBySession)){ const arr=(searchCardsBySession[k]||[]).filter(r=>r&&!r.dismissed); if(arr.length) searchCardsBySession[k]=arr; else delete searchCardsBySession[k]; arr.forEach(r=>all.push(r)); }
      if(all.length>60){ all.sort((a,b)=>(b.ts||0)-(a.ts||0)); const keep=new Set(all.slice(0,60).map(r=>r.cid));
        for(const k of Object.keys(searchCardsBySession)){ searchCardsBySession[k]=searchCardsBySession[k].filter(r=>keep.has(r.cid)); if(!searchCardsBySession[k].length) delete searchCardsBySession[k]; } }
      localStorage.setItem('jarvis_search_cards',JSON.stringify(searchCardsBySession));
    }catch(e){} }
    // Modelo/esforço REAIS que a sessão nativa (criada na máquina) reporta — o servidor lê do transcript.
    // Só as sessões nativas mandam isso; sessão gerenciada deixa null e cai no pref/default como antes.
    let sessDeclModel=null, sessDeclEffort=null, lastRouteReason='';
    function routeAutoFor(sid){ const p=sessionValue(sessionPrefs,sid,sessionRunner())||{}; return {agent:p.agent===AUTO_AGENT,model:p.model===AUTO_MODEL,effort:p.effort===AUTO_EFFORT}; }
    function syncModelEffort(){ const c=capsFor(currentAgent); const pref=currentSession==null?{}:(sessionValue(sessionPrefs,currentSession,currentSessionRunner)||{});
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
      curMode = pref.permissionMode || (currentSession==null ? ((sdDoc.global&&sdDoc.global.permissionMode)||null) : null);
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
    function pickMachine(title,subtitle){ return new Promise(res=>{
      const ov=document.createElement('div'); ov.className='modal';
      const card=document.createElement('div'); card.className='card machinepick';
      card.innerHTML='<div class="mph"><b>'+esc(title||'Criar nova sessão')+'</b><span>'+esc(subtitle||'Escolha onde o agente vai rodar.')+'</span></div>';
      const list=document.createElement('div'); list.className='mplist';
      const done=(v)=>{ if(ov.parentNode) document.body.removeChild(ov); res(v); };
      machines.forEach(m=>{ const b=document.createElement('button'); b.className='mpopt'; b.type='button';
        const agents=Array.isArray(m.agents)?m.agents.length:0, tag=m.local?'servidor':(m.online?'online':'offline');
        b.innerHTML='<span class="mdot '+(m.online?'on':'off')+'"></span><span class="mpmain"><b>'+esc(m.label)+'</b><span>'+esc(tag)+(m.online&&agents?' · '+agents+' IA'+(agents===1?'':'s'):'')+'</span></span><span class="mcaret">›</span>';
        b.disabled=!m.online; b.onclick=()=>done(m.id); list.appendChild(b); });
      card.appendChild(list);
      const cancel=document.createElement('button'); cancel.className='ghost mpcancel'; cancel.type='button'; cancel.textContent='Cancelar'; cancel.onclick=()=>done(null); card.appendChild(cancel);
      ov.appendChild(card); ov.onclick=(e)=>{ if(e.target===ov) done(null); }; document.body.appendChild(ov); }); }
    // Cria sessão vazia (agente/pasta ajustáveis pelos pills até a 1ª msg). opts.target fixa a máquina
    // (pula o picker), opts.cwd fixa a pasta — usados pelo "+" de cada grupo (projeto/máquina) na lista.
    async function startNewSession(opts){ opts=opts||{};
      let target=opts.target||currentMachine;
      if((!opts.target && currentMachine==='all')){ const mid=await pickMachine(); if(!mid) return; target=mid; }
      if(currentMachine==='all' && target!==routedMachine){ routedMachine=target; tx({t:'runner',runnerId:target}); }
      const pm=machines.find(x=>x.id===target); const avail=(pm&&Array.isArray(pm.agents)&&pm.agents.length)?pm.agents:machineAgents();
      let agent=opts.agent||cfg.agent||currentAgent||(caps[0]||{}).name; if(!avail.includes(agent)) agent=avail[0]||agent;
      const cwd=opts.cwd!=null?opts.cwd:(target==='local'?(cfg.lastCwd||''):'');
      if(currentSession!=null){ draftBySession[sessionStateKey(currentSession,currentSessionRunner)]=E.input.value; saveDrafts(); stashAttachments(currentSession,currentSessionRunner); }
      pendingNewSession={runnerId:target,agent,cwd,at:Date.now()}; creatingSession=true; currentSession=null; currentSessionRunner=target; activeRuns=activeRunsByRunner[target]||[]; curStarted=false; curNative=false; curNativeWritable=false; curNativeId=''; attachments=[]; renderAttach(); clearQueue(); updateOfflineBanner(); setHash('');
      E.title.textContent='Criando sessão...'; refreshTitleInfo(); E.log.innerHTML=''; tx({t:'new',agent,cwd}); closeSide(); }
    E.newSess.onclick=()=>startNewSession();

    // ---------- search (input com foco imediato; sem prompt) ----------
    E.searchBtn.onclick=()=>openSearch();
    // O clique no cabecalho minimiza — mas "selecionar" vive dentro dele: sem o guard abaixo,
    // clicar em selecionar fecharia a secao inteira que voce acabou de pedir pra usar.
    E.tabRec.onclick=()=>selectTab('rec');
    E.tabFiles.onclick=()=>selectTab('files');
    selectTab(cfg.tab);
    E.digestBtn.onclick=()=>{ if(!startVoiceOp('digest',E.digestBtn,'⏳ gerando…'))return; status('speaking',t('stAnalyzing')); tx({t:'digest',speak:true}); };
    const SOLUTION_MODES=['council','benchmark','review','audit','debate'];
    const SOLUTION_HELP={council:'swHelpCouncil',benchmark:'swHelpBenchmark',review:'swHelpReview',audit:'swHelpAudit',debate:'swHelpDebate'};
    const SOLUTION_LABEL={council:'swModeCouncil',benchmark:'swModeBenchmark',review:'swModeReview',audit:'swModeAudit',debate:'swModeDebate'};
    const SOLUTION_MAX_CHARS=20000;   // espelha o corte do servidor (index.ts: msg.topic/task.slice(0,20_000)) — feedback pra não truncar em silêncio
    // Espaço de Soluções ARMADO por sessão, igual às pills de modelo/esforço: o que persiste é só COMO a
    // rodada roda — o objetivo vem do próprio chat, não de um campo separado. `mode:null` = desligado.
    // `persist` decide o que acontece depois do envio: 'once' desarma sozinho (protege contra disparar
    // 2-6 execuções paralelas sem querer na mensagem seguinte); 'always' fica ligado até você desligar.
    // councilEffort é separado de `effort` (do Debate): o Conselho antes herdava o esforço da pill do
    // composer, que agora fica escondida — '' mantém o automático de hoje em vez de forçar um nível.
    const SOLUTION_DEFAULTS={mode:null,persist:'once',councilMode:'auto',context:true,agentsMode:'auto',agents:[],count:3,rounds:3,effort:'high',councilEffort:'',write:true,postAction:'none'};
    const solutionArmBySession=(()=>{ try{ return JSON.parse(localStorage.getItem('jarvis_solution_arm')||'{}'); }catch(e){ return {}; } })();
    function saveSolutionArms(){ try{ localStorage.setItem('jarvis_solution_arm', JSON.stringify(solutionArmBySession)); }catch(e){} }
    function solutionArm(){ return Object.assign({},SOLUTION_DEFAULTS,sessionValue(solutionArmBySession,currentSession,currentSessionRunner)||{}); }
    function solutionArmed(){ return SOLUTION_MODES.includes(solutionArm().mode); }
    function solutionUsable(){ return !!currentSession&&!curNative; }
    function setSolutionArm(patch){
      if(currentSession==null)return;
      const key=sessionStateKey(currentSession,currentSessionRunner), next=Object.assign(solutionArm(),patch||{});
      if(!SOLUTION_MODES.includes(next.mode)) delete solutionArmBySession[key]; else solutionArmBySession[key]=next;
      saveSolutionArms(); renderSolutionPill();
    }
    function disarmSolution(){ setSolutionArm({mode:null}); }
    function solutionDescriptors(){
      return availableMachineCaps().filter(c=>c&&c.name&&!['not_installed','unauthenticated'].includes(c.support||''));
    }
    function selectedSolutionDescriptors(){
      const all=solutionDescriptors(), c=solutionArm();
      if(c.agentsMode==='all')return all;
      if(c.agentsMode==='manual'){
        const picked=Array.isArray(c.agents)?c.agents:[], chosen=all.filter(d=>picked.includes(d.name));
        if(chosen.length)return chosen;   // seleção vazia cai no automático em vez de rodar sem IA nenhuma
      }
      const preferred=all.find(d=>d.name===currentAgent)||all[0];
      return preferred?[preferred,...all.filter(d=>d.name!==preferred.name)]:all;
    }
    function solutionCompetitors(){
      const descs=selectedSolutionDescriptors(), count=Math.min(6,Math.max(2,Number(solutionArm().count)||3));
      const pool=[];
      descs.forEach(d=>{
        const ms=selectableModels(d);
        if(ms.length)ms.forEach(m=>pool.push({agent:d.name,model:m.id,effort:m.defaultEffort||(m.efforts||[])[0],label:(d.label||d.name)+' · '+(m.label||m.id)}));
        else pool.push({agent:d.name,label:d.label||d.name});
      });
      const src=pool.length?pool:[{agent:currentAgent||cfg.agent||'claude-code',model:curModel||undefined,effort:curEffort||undefined,label:currentAgent||cfg.agent||'agente'}];
      return Array.from({length:count},(_v,i)=>Object.assign({},src[i%src.length],{label:(src[i%src.length].label||src[i%src.length].agent)+(i>=src.length?' #'+(i+1):'')}));
    }
    function solutionPostfix(){
      const v=solutionArm().postAction;
      if(v==='plan')return '\n\nResultado esperado: alem da conclusao, gere um plano de execucao claro, ordenado e acionavel.';
      if(v==='handoff')return '\n\nResultado esperado: prepare um encaminhamento pronto para uma IA executar depois, com objetivo, contexto, passos, criterios de aceite e riscos.';
      return '';
    }
    // Contador do teto: o servidor corta (texto+postfix) em SOLUTION_MAX_CHARS. Em vez de truncar em
    // silêncio, mostra o quanto foi usado e avisa do corte. Só aparece com uma rodada armada — turno
    // normal de chat não tem esse limite.
    function updateSolutionCount(){
      if(!E.solutionChars)return;
      if(!solutionArmed()){ E.solutionChars.textContent=''; return; }
      const len=((E.input&&E.input.value)||'').length+solutionPostfix().length;
      const over=len>SOLUTION_MAX_CHARS;
      E.solutionChars.textContent=`${len} / ${SOLUTION_MAX_CHARS}`+(over?` · será cortado em ${SOLUTION_MAX_CHARS} ao enviar`:'');
      E.solutionChars.classList.toggle('over',over);
      E.solutionChars.classList.toggle('warn',!over&&len>SOLUTION_MAX_CHARS*0.9);
    }
    function solutionModeLabel(mode){ return t(SOLUTION_LABEL[mode]||'swModeCouncil'); }
    function solutionSummary(){
      const c=solutionArm(); if(!SOLUTION_MODES.includes(c.mode))return '';
      const parts=[];
      if(c.mode==='debate') parts.push(c.rounds+(Number(c.rounds)===1?' rodada':' rodadas'));
      else if(c.mode!=='council') parts.push(c.count+' execuções');
      parts.push(c.persist==='always'?'sempre ativo':'só o próximo envio');
      return parts.join(' · ');
    }
    // A pill fica azul preenchida e a barra aparece sobre o composer: com uma rodada armada o próximo
    // envio não é um turno normal, e isso precisa estar visível ANTES de apertar enviar.
    function renderSolutionPill(){
      const c=solutionArm(), usable=solutionUsable(), on=SOLUTION_MODES.includes(c.mode)&&usable;
      if(E.solutionBtn){
        E.solutionBtn.classList.toggle('on',on);
        E.solutionBtn.classList.toggle('lock',!usable);
        E.solutionBtn.disabled=!usable;
        E.solutionBtn.title=!currentSession?t('tOpenFirst'):(curNative?t('swNative'):(on?(solutionModeLabel(c.mode)+' — '+solutionSummary()):t('swTitle')));
      }
      if(E.solutionName)E.solutionName.textContent=on?solutionModeLabel(c.mode):'—';
      if(E.solutionBar)E.solutionBar.classList.toggle('hidden',!on);
      if(E.composer)E.composer.classList.toggle('sol-armed',on);   // esconde agente/modelo/esforço: quem manda é a config da rodada
      if(on){
        if(E.solBarMode)E.solBarMode.textContent=solutionModeLabel(c.mode);
        if(E.solBarMeta)E.solBarMeta.textContent=solutionSummary();
      }
      updateSolutionCount();
    }
    function buildSolutionPop(p){
      p.appendChild(ph(t('swName')));
      if(currentSession==null||curNative){
        const n=document.createElement('div'); n.className='mut'; n.style.cssText='padding:0 2px 4px;font-size:11.5px';
        n.textContent=currentSession==null?'Abra uma sessão para armar uma rodada.':t('swNative'); p.appendChild(n); return;
      }
      const c=solutionArm(), armed=SOLUTION_MODES.includes(c.mode);
      const reopen=()=>replaceOpenPop(E.solutionBtn,buildSolutionPop);
      const off=document.createElement('div'); off.className='opt'+(armed?'':' sel');
      off.innerHTML='✖ Desligado'+(armed?'':'<span class="r">atual</span>');
      off.onclick=()=>{ closePop(); disarmSolution(); };
      p.appendChild(off);
      SOLUTION_MODES.forEach(m=>{
        const o=document.createElement('div'); o.className='opt'+(c.mode===m?' sel':'');
        o.innerHTML=esc(solutionModeLabel(m))+(c.mode===m?'<span class="r">atual</span>':'');
        o.title=t(SOLUTION_HELP[m]||'swHelpCouncil');
        o.onclick=()=>{ setSolutionArm({mode:m}); reopen(); };
        p.appendChild(o);
      });
      if(!armed)return;
      // Ajuda de UM modo só, o escolhido: descrever os cinco de uma vez fazia o popover passar da
      // altura da tela no celular e colava rótulo e descrição na mesma linha.
      const help=document.createElement('div'); help.className='solutionhelp'; help.textContent=t(SOLUTION_HELP[c.mode]||'swHelpCouncil'); p.appendChild(help);
      // Cada seção = uma decisão de tipo diferente, com régua no cabeçalho e os parâmetros num poço
      // recuado; as escolhas (modos) ficam soltas sobre o painel. A separação carrega informação.
      const sec=(title)=>{ const h=document.createElement('div'); h.className='solsec'; h.textContent=title; p.appendChild(h);
        const w=document.createElement('div'); w.className='solwell'; p.appendChild(w); return w; };
      const row=(host,label,ctl,title)=>{ const d=document.createElement('div'); d.className='solrow'; if(title)d.title=title; const s=document.createElement('span'); s.textContent=label; d.appendChild(s); d.appendChild(ctl); host.appendChild(d); return d; };
      // Switch em vez de checkbox: liga/desliga binário lê melhor numa linha de ajuste. Não remonta o
      // popover ao alternar — só grava e atualiza a pill/barra, então o toque responde na hora.
      const sw=(val,fn)=>{ const b=document.createElement('button'); b.type='button'; b.className='sw'; b.setAttribute('role','switch');
        b.setAttribute('aria-checked',String(val!==false)); b.appendChild(document.createElement('span'));
        b.onclick=()=>{ const next=b.getAttribute('aria-checked')!=='true'; b.setAttribute('aria-checked',String(next)); fn(next); };
        return b; };
      const keepWell=sec('Depois do envio');
      row(keepWell,'Manter ligado',sw(c.persist==='always',v=>setSolutionArm({persist:v?'always':'once'})),
        'Ligado: todo envio vira uma rodada. Desligado: desarma sozinho ao disparar.');
      const runWell=sec('Como rodar');
      const sel=(opts,val,fn)=>{ const s=document.createElement('select'); opts.forEach(([v,l])=>{ const o=document.createElement('option'); o.value=v; o.textContent=l; s.appendChild(o); }); s.value=val; s.onchange=()=>fn(s.value); return s; };
      const num=(val,min,max,fn)=>{ const i=document.createElement('input'); i.type='number'; i.min=String(min); i.max=String(max); i.value=String(val); i.onchange=()=>fn(Math.min(max,Math.max(min,Number(i.value)||min))); return i; };
      const isCouncil=c.mode==='council', isDebate=c.mode==='debate', isBenchmark=c.mode==='benchmark';
      if(isCouncil) row(runWell,'Lentes',sel([['auto','Auto'],['quick','Rápido'],['technical','Técnico'],['critical','Crítico'],['deep','Profundo']],c.councilMode,v=>setSolutionArm({councilMode:v})));
      if(isCouncil||isDebate) row(runWell,'Contexto recente',sw(c.context,v=>setSolutionArm({context:v})),'Inclui as últimas mensagens da sessão no material da rodada.');
      if(!isCouncil&&!isDebate) row(runWell,'Execuções paralelas',num(c.count,2,6,v=>setSolutionArm({count:v})));
      if(isDebate){ row(runWell,'Rodadas (teto)',num(c.rounds,1,6,v=>setSolutionArm({rounds:v}))); row(runWell,'Esforço das IAs',sel([['medium','Médio'],['high','Alto'],['max','Máximo']],c.effort,v=>setSolutionArm({effort:v}))); }
      if(isCouncil) row(runWell,'Esforço das IAs',sel([['','Automático'],['medium','Médio'],['high','Alto'],['max','Máximo']],c.councilEffort||'',v=>setSolutionArm({councilEffort:v})),
        'Automático: cada IA usa o esforço padrão do próprio modelo.');
      if(isBenchmark) row(runWell,'Worktrees isoladas',sw(c.write,v=>setSolutionArm({write:v})),'Cada candidato escreve numa cópia isolada do repo para produzir um diff real.');
      row(runWell,'Ao terminar',sel([['none','Só publicar'],['plan','Gerar plano'],['handoff','Encaminhamento']],c.postAction,v=>setSolutionArm({postAction:v})),
        'O que a rodada entrega além da conclusão.');
      row(runWell,'IAs',sel([['auto','Automático'],['all','Todas'],['manual','Selecionar']],c.agentsMode,v=>{ setSolutionArm({agentsMode:v}); reopen(); }));
      if(c.agentsMode==='manual'){
        const list=solutionDescriptors(), picked=new Set(Array.isArray(c.agents)?c.agents:[]);
        const box=document.createElement('div'); box.className='agentlist';
        list.forEach(d=>{
          const lab=document.createElement('label'); lab.className='row';
          const i=document.createElement('input'); i.type='checkbox'; i.value=d.name; i.checked=picked.has(d.name);
          i.onchange=()=>{ if(i.checked)picked.add(d.name); else picked.delete(d.name); setSolutionArm({agents:[...picked]}); };
          const text=document.createElement('span'); text.className='adesc';
          const b=document.createElement('b'); b.textContent=(d.label||d.name);
          const s=document.createElement('span'); const ms=selectableModels(d); s.textContent=(ms.length?ms.length+' modelos':'modelo automático')+' · '+(d.name||'');
          text.appendChild(b); text.appendChild(s); lab.appendChild(i); lab.appendChild(text); box.appendChild(lab);
        });
        if(!list.length){ const n=document.createElement('div'); n.className='mut'; n.style.fontSize='12px'; n.textContent='nenhuma IA disponível'; box.appendChild(n); }
        runWell.appendChild(box);
      }
    }
    // O chat É o objetivo: com uma rodada armada, enviar dispara council/debate/tournament no lugar do turno.
    function startSolutionRound(topic){
      const c=solutionArm(), fullTopic=topic+solutionPostfix(), selected=selectedSolutionDescriptors().map(d=>d.name);
      if(c.mode==='council'){
        // Sem `model`: era uma preferência do composer que cada IA resolvia contra o próprio catálogo
        // (council.ts optionFor), então valia para uma e caía no default das outras. Cada membro usa
        // o modelo padrão dele; o esforço vem da config da rodada.
        tx({t:'council_start',sessionId:currentSession,topic:fullTopic,mode:c.councilMode,includeContext:c.context!==false,effort:c.councilEffort||undefined,agents:selected});
      }else if(c.mode==='debate'){
        tx({t:'debate_start',sessionId:currentSession,topic:fullTopic,includeContext:c.context!==false,agents:selected,
          maxRounds:Math.min(6,Math.max(1,Number(c.rounds)||3)),
          effortLevel:['medium','high','max'].includes(c.effort)?c.effort:'high'});
      }else{
        tx({t:'tournament_start',sessionId:currentSession,task:fullTopic,mode:c.mode,competitors:solutionCompetitors(),write:c.mode==='benchmark'&&c.write!==false});
      }
      if(c.persist!=='always') disarmSolution(); else renderSolutionPill();
      toast(c.mode==='council'?'Conselho convocado.':c.mode==='debate'?'Debate iniciado.':t('swStarted'));
    }
    if(E.solutionBtn) E.solutionBtn.onclick=()=>{
      if(!currentSession){ toast(t('tOpenFirst')); return; }
      if(curNative){ toast(t('swNative')); return; }
      togglePop(E.solutionBtn,buildSolutionPop);
    };
    if(E.solBarOff) E.solBarOff.onclick=()=>disarmSolution();
    renderSolutionPill();
    // Resumir a sessão ATUAL exigia abrir a barra lateral e achar a sessão na lista — no celular,
    // onde a lateral é overlay, isso é o caminho todo. O panorama (🎧) fica só na lateral: dois
    // ícones de áudio lado a lado não diziam qual era o escopo de cada um.
    E.sumHdr.onclick=()=>{ if(!currentSession){ toast(t('tOpenFirst')); return; }
      if(!startVoiceOp('summarize',E.sumHdr,'⏳',currentSession))return; status('speaking',t('stSummarizing')); tx({t:'summarize',sessionId:currentSession,speak:true}); };
    // ---------- canvas: overlay central iterativo (voz: resolução de sessão, pasta, confirmação; depois imagens/diagramas) ----------
    function hideCanvas(){ E.canvasModal.classList.add('hidden'); restoreFocusAfterModal(E.canvasModal); }
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
        h+=`<div style="padding:6px 0;border-bottom:1px solid var(--line)"><div style="display:flex;align-items:center;gap:7px;margin-bottom:3px"><span class="mdot ${x.online?'on':'off'}"></span><span style="color:var(--text);font-weight:600">${esc(x.label||x.id)}</span><span class="mut" style="font-size:10.5px">${x.online?'online':'offline'}${(x.build||x.commit)?' · '+fmtBuild(x.build,x.commit):''}</span></div>${rows}</div>`; });
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
          <span class="mdot ${x.online?'on':'off'}"></span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(x.label||x.id)}${(x.build||x.commit)?` <span class="mut" style="font-size:10.5px">${fmtBuild(x.build,x.commit)}</span>`:''}</span>${badges.join(' ')}</div>`; });
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
    // O item de nav é owner-only via .snav-owner (settingsSetupNav); aqui só reagimos a uma troca de
    // papel com as configurações JÁ abertas, senão o painel continuaria listado para um membro.
    function updateOwnerUI(){ settingsOwnerVisibility(!!(authUser&&authUser.role==='owner')); }
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
    function renderPushStatus(st){
      if(!E.pushStatus)return;
      if(!st){ E.pushStatus.textContent='Status de push não verificado.'; return; }
      const bits=[];
      bits.push(`${st.mobileTokens||0} token(s) Android`);
      bits.push(`${st.webSubs||0} inscrição(ões) Web Push`);
      bits.push(st.fcmConfigured?`FCM ativo${st.fcmProjectId?' · '+st.fcmProjectId:''}`:(st.fcmEnvSet?'FCM com credencial inválida':'FCM não configurado no Hub'));
      E.pushStatus.textContent=bits.join(' · ');
    }
    function requestPushStatus(){ if(E.pushStatus)E.pushStatus.textContent='Verificando push…'; tx({t:'push_status'}); }
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
    async function updatePushPrefs(pp){ if(window.__jarvisNative&&window.__jarvisNative.updatePush) return window.__jarvisNative.updatePush(pp);
      try{ const reg=await navigator.serviceWorker.getRegistration(); const sub=reg&&await reg.pushManager.getSubscription(); if(sub) tx({t:'push_prefs', endpoint:sub.endpoint, prefs:pp}); return true; }catch(e){ return false; } }
    var bioOverlay=null, bioPrompting=false, bioUnlockedAt=0;
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
        var handlePushAction=function(event){
          var notification=event&&event.notification, data=notification&&notification.data;
          var link=data&&typeof data.url==='string'?data.url:'';
          if(!link&&event&&event.data&&typeof event.data.url==='string')link=event.data.url;
          if(link)setTimeout(function(){queuePersonalDeepLink(link);},0);
        };
        ['pushNotificationActionPerformed','actionPerformed'].forEach(function(eventName){
          try{var listener=PN.addListener(eventName,handlePushAction);if(listener&&typeof listener.catch==='function')listener.catch(function(){});}catch(e){}
        });
        N.push=async function(prefs){ try{
          wantEvents=(prefs&&prefs.events&&prefs.events.length)?prefs.events:wantEvents;
          var perm=await PN.checkPermissions(); if(perm.receive!=='granted') perm=await PN.requestPermissions();
          if(perm.receive!=='granted'){ toast(t('tPushDenied')); return false; }
          await PN.register(); cfg.push=true; cfg.pushPendingNative=false; saveCfg(); return true;
        }catch(e){ toast('Falha no push nativo: '+(e.message||e)); return false; } };
        N.disablePush=async function(){ cfg.push=false; cfg.pushPendingNative=false; saveCfg(); try{ if(N._lastToken) tx({t:'mobile_push_unregister',token:N._lastToken}); }catch(e){} };
        N.updatePush=async function(prefs){ wantEvents=(prefs&&prefs.events&&prefs.events.length)?prefs.events:wantEvents; if(N._lastToken) tx({t:'mobile_push_register',token:N._lastToken,platform:platform,events:wantEvents}); return true; };
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
    // --- Atualização do APP desktop (Electron). O shell empacotado expõe window.jarvis.updater; num
    //     navegador comum / Capacitor ele não existe e todo este bloco é um no-op (LEI 2), então os
    //     controles ficam escondidos. A UI mostra banner + "Verificar" + "Reiniciar e instalar" aqui
    //     mesmo, em vez de um diálogo nativo que o resto da interface não conhece. ---
    (function(){ var U=window.jarvis&&window.jarvis.updater; if(!U) return;
      var st={state:'idle'};
      function label(){ switch(st.state){
        case 'checking': return 'Procurando atualização…';
        case 'available': return 'Atualização '+(st.version||'')+' encontrada — baixando…';
        case 'downloading': return 'Baixando atualização… '+(st.percent||0)+'%';
        case 'downloaded': return 'Atualização '+(st.version||'')+' pronta para instalar.';
        case 'none': return 'Você está na versão mais recente'+(window.jarvis.shellVersion?(' ('+window.jarvis.shellVersion+')'):'')+'.';
        case 'error': return '⚠ '+(st.error||'falha ao verificar atualização');
        case 'unsupported': return 'Auto-update indisponível nesta execução (build não empacotado).';
        default: return 'Versão '+(window.jarvis.shellVersion||'?')+'.'; } }
      function render(){
        if(E.appUpdBox) E.appUpdBox.classList.remove('hidden');
        if(E.appUpdStatus) E.appUpdStatus.textContent=label();
        var ready=st.state==='downloaded';
        if(E.appUpdInstall) E.appUpdInstall.classList.toggle('hidden',!ready);
        if(E.appUpdCheck) E.appUpdCheck.disabled=(st.state==='checking'||st.state==='downloading');
        // banner no topo só quando há algo acionável (baixando ou pronto) — não polui o resto do tempo
        if(E.appUpdBar){
          var show=ready||st.state==='downloading'||st.state==='available';
          E.appUpdBar.classList.toggle('hidden',!show);
          if(show){ E.appUpdBar.innerHTML=''; var t=document.createElement('span'); t.textContent='⬆ '+label(); E.appUpdBar.appendChild(t);
            var sp=document.createElement('span'); sp.className='spacer'; E.appUpdBar.appendChild(sp);
            if(ready){ var b=document.createElement('button'); b.textContent='Reiniciar e instalar'; b.onclick=doInstall; E.appUpdBar.appendChild(b); }
            var x=document.createElement('button'); x.className='ghost'; x.textContent='✕'; x.title='Ocultar'; x.onclick=()=>E.appUpdBar.classList.add('hidden'); E.appUpdBar.appendChild(x); }
        }
      }
      async function doCheck(){ st={state:'checking'}; render(); try{ var r=await U.check(); if(r&&r.state==='unsupported'){ st=r; } else if(r&&r.state==='error'){ st=r; } render(); }catch(e){ st={state:'error',error:String(e&&e.message||e)}; render(); } }
      async function doInstall(){ try{ var r=await U.install(); if(r&&r.ok===false) toast('⚠ '+(r.error||'nada para instalar')); }catch(e){ toast('⚠ falha ao instalar'); } }
      U.onEvent(function(ev){ if(ev&&ev.state){ st=ev; render(); } });
      if(E.appUpdCheck) E.appUpdCheck.onclick=doCheck;
      if(E.appUpdInstall) E.appUpdInstall.onclick=doInstall;
      render();
    })();
    // --- Electron desktop shell bridge (window.jarvis) + Design Mode. Runs ONLY inside the Electron
    //     app; a plain browser / Capacitor has no window.jarvis, so the button stays hidden and every
    //     other path is untouched (LEI 2). The <webview> preview is created here; main does the
    //     privileged grab/capture via window.jarvis.browser (see desktop/). ---
    (function(){ var J=window.jarvis; if(!J||!J.capabilities||!J.capabilities.designMode||!J.browser) return;
      try{ document.documentElement.classList.add('electron'); }catch(e){}
      if(E.designBtn) E.designBtn.classList.remove('hidden'); })();
    var designWV=null, designSelections=[], pendingPreview=null, designCoverageOn=false, designCoverageLast=null, designEvents=[];
    function designWCId(){ try{ return designWV&&designWV.getWebContentsId(); }catch(e){ return null; } }
    function designStatus(s){ if(E.designStatus) E.designStatus.textContent=s||''; }
    function designEvent(kind,data){ designEvents.push(Object.assign({kind,at:Date.now()},data||{})); if(designEvents.length>80)designEvents=designEvents.slice(-80); renderDesignCoverage(); }
    function renderDesignCoverage(){ if(!E.designCoverage)return; const cov=designCoverageLast, ev=designEvents.slice(-3).map(e=>e.kind+(e.url?' '+e.url:'')).join(' · ');
      if(!cov){ E.designCoverage.textContent=(designCoverageOn?'Coverage ativo. ':'Coverage/source map best-effort. ')+(ev||'Aguardando navegação.'); return; }
      const js=(cov.js||[]).length, css=(cov.css||[]).length, usedCss=(cov.css||[]).filter(r=>r.used).length;
      E.designCoverage.textContent=`Coverage coletado: ${js} script(s), ${usedCss}/${css} regra(s) CSS usadas.`+(ev?' · '+ev:''); }
    function renderDesignSelections(){ if(E.designCount)E.designCount.textContent=String(designSelections.length); if(!E.designSelList)return; E.designSelList.innerHTML='';
      designSelections.forEach(function(item,idx){ const sel=item.sel||{}, row=document.createElement('div'); row.className='designpick'; row.dataset.id=item.id;
        if(sel._png){ const im=document.createElement('img'); im.src=sel._png; im.alt=''; row.appendChild(im); } else { const ph=document.createElement('div'); ph.style.cssText='width:64px;height:48px;border:1px solid var(--line);border-radius:5px;background:#fff1'; row.appendChild(ph); }
        const meta=document.createElement('div'); meta.className='dmeta';
        const a=document.createElement('div'); a.className='dsel'; a.textContent=(idx+1)+'. '+(sel.selector||'elemento'); meta.appendChild(a);
        const src=document.createElement('div'); src.className='dsrc'; src.textContent=sel.sourceRef?(sel.sourceRef.file+':'+sel.sourceRef.line):((sel.rect?Math.round(sel.rect.width)+'x'+Math.round(sel.rect.height)+' px':'sem captura')); meta.appendChild(src);
        const note=document.createElement('textarea'); note.placeholder='Comentário para este item…'; note.value=item.note||''; note.oninput=function(){ item.note=note.value; }; meta.appendChild(note); row.appendChild(meta);
        const x=document.createElement('button'); x.type='button'; x.className='ghost dx'; x.textContent='✕'; x.title='Remover seleção'; x.onclick=function(){ designSelections=designSelections.filter(v=>v.id!==item.id); renderDesignSelections(); designStatus(designSelections.length?'Seleção removida.':'Nenhuma seleção no pacote.'); }; row.appendChild(x);
        E.designSelList.appendChild(row); }); }
    async function startDesignCoverage(){ var B=window.jarvis&&window.jarvis.browser,id=designWCId(); if(!B||id==null||!B.startCoverage||designCoverageOn)return; try{ const r=await B.startCoverage(id); designCoverageOn=!!(r&&r.ok); designCoverageLast=null; renderDesignCoverage(); }catch(e){ designCoverageOn=false; renderDesignCoverage(); } }
    async function stopDesignCoverage(){ var B=window.jarvis&&window.jarvis.browser,id=designWCId(); if(!B||id==null||!B.stopCoverage)return null; try{ const c=await B.stopCoverage(id); designCoverageOn=false; designCoverageLast=c||null; renderDesignCoverage(); return c||null; }catch(e){ designCoverageOn=false; renderDesignCoverage(); return null; } }
    function ensureDesignWebview(url){ if(!E.designHost) return;
      if(!designWV){ designWV=document.createElement('webview'); designWV.setAttribute('allowpopups','false'); designWV.style.cssText='width:100%;height:100%;border:0;background:#fff'; E.designHost.innerHTML=''; E.designHost.appendChild(designWV);
        designWV.addEventListener('dom-ready',function(){ designEvent('ready',{url:designWV.getURL&&designWV.getURL()}); startDesignCoverage(); });
        designWV.addEventListener('did-navigate',function(ev){ designEvent('navigate',{url:ev.url}); });
        designWV.addEventListener('did-navigate-in-page',function(ev){ designEvent('navigate-in-page',{url:ev.url}); });
        designWV.addEventListener('did-fail-load',function(ev){ designEvent('load-failed',{url:ev.validatedURL}); designStatus('Falha ao carregar preview.'); });
      }
      if(url){ try{ designWV.src=url; designEvent('open',{url}); }catch(e){} } }
    function openDesign(){ if(!(window.jarvis&&window.jarvis.capabilities&&window.jarvis.capabilities.designMode)) return;
      E.designPanel.classList.remove('hidden'); renderDesignSelections(); renderDesignCoverage(); ensureDesignWebview(E.designUrl.value||''); if(!E.designUrl.value) detectDesignPreview(); }
    function closeDesign(){ E.designPanel.classList.add('hidden');
      try{ var id=designWCId(); if(id!=null&&window.jarvis.browser) window.jarvis.browser.cancelGrab(id).catch(function(){}); }catch(e){}
      if(designCoverageOn) stopDesignCoverage(); if(E.designHost) E.designHost.innerHTML=''; designWV=null; }
    function detectDesignPreview(){ designStatus('Detectando preview…'); var done=false;
      var timer=setTimeout(function(){ if(done)return; done=true; pendingPreview=null; designStatus('Nenhum preview detectado — digite a URL manualmente.'); },4000);
      pendingPreview=function(cands){ if(done)return; done=true; clearTimeout(timer);
        if(cands&&cands.length){ E.designUrl.value=cands[0].url; ensureDesignWebview(cands[0].url); designStatus('Preview: '+cands[0].url+(cands.length>1?(' (+'+(cands.length-1)+' outra(s))'):'')); }
        else designStatus('Nenhum preview detectado — digite a URL manualmente.'); };
      tx({t:'getWorktreePreview',sessionId:currentSession,runnerId:sessionRunner()}); }
    async function grabDesignElement(){ var B=window.jarvis&&window.jarvis.browser, id=designWCId();
      if(!B||id==null){ designStatus('Preview ainda não está pronto — carregue uma URL primeiro.'); return; }
      designStatus('Clique num elemento do preview…  (Esc cancela)');
      try{ await B.setGrabMode(id,true); var sel=await B.awaitGrabSelection(id);
        var shot=await B.captureSelectionScreenshot(id,sel.rect); sel._png=(shot&&shot.pngDataUrl)?shot.pngDataUrl:null;
        const item={id:'dsel-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),sel,note:''}; designSelections.push(item); designEvent('selection',{selector:sel.selector,url:sel.url});
        renderDesignSelections(); designStatus('Elemento adicionado ao pacote — selecione outro ou envie.'); try{ const ta=E.designSelList.querySelector('[data-id="'+item.id+'"] textarea'); ta&&ta.focus(); }catch(e){}
      }catch(err){ designStatus('Seleção cancelada.'); } }
    function designCoverageMd(cov){ if(!cov)return ''; const js=(cov.js||[]).slice(0,8).map(x=>'- JS: '+(x.url||'(inline)')+' ranges='+(x.ranges?x.ranges.length:0)); const css=(cov.css||[]).filter(x=>x.used).slice(0,12).map(x=>'- CSS: '+(x.styleSheetId||'rule')+' '+(x.startOffset||0)+'-'+(x.endOffset||0)); const sm=(cov.scripts||[]).slice(0,12).map(x=>'- Source map: '+(x.url||'(inline)')+' -> '+x.sourceMapURL); return ['### Coverage / Source map best-effort'].concat(js,css,sm).join('\n'); }
    function cacheDesignArtifact(items,note,cov){ const id='design-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7); try{ const key='jarvis_design_artifacts', old=JSON.parse(localStorage.getItem(key)||'[]'); old.push({id,at:Date.now(),sessionId:currentSession,runnerId:currentSessionRunner,url:E.designUrl.value||'',note,selectors:items.map(x=>x.sel&&x.sel.selector).filter(Boolean),coverage:{js:(cov&&cov.js||[]).length,css:(cov&&cov.css||[]).length,sourcemaps:(cov&&cov.scripts||[]).length}}); localStorage.setItem(key,JSON.stringify(old.slice(-30))); }catch(e){} return id; }
    function designFeedbackMd(items,note,cov,artifactId){ var L=['## Design Feedback Package','- Artefato Jarvis: `'+artifactId+'`','- URL atual: '+(E.designUrl.value||''),'- Seleções: '+items.length,'- Eventos recentes: '+designEvents.slice(-8).map(e=>e.kind+(e.url?' '+e.url:'')).join(' | '),'','### Pedido geral',note||'(sem comentário geral)'];
      items.forEach(function(item,idx){ var sel=item.sel||{}; L.push('','### Seleção '+(idx+1),'- URL: '+(sel.url||''),'- Seletor: `'+(sel.selector||'')+'`');
        if(sel.sourceRef) L.push('- Fonte provável: `'+sel.sourceRef.file+':'+sel.sourceRef.line+':'+sel.sourceRef.column+'` ('+sel.sourceRef.framework+')');
        if(sel.components&&sel.components.length) L.push('- Componentes: '+sel.components.join(' -> '));
        if(sel.rect) L.push('- Bounds: '+Math.round(sel.rect.width)+'x'+Math.round(sel.rect.height)+' px em '+Math.round(sel.rect.x)+','+Math.round(sel.rect.y));
        if(sel.a11y&&(sel.a11y.role||sel.a11y.name)) L.push('- A11y: '+[sel.a11y.role,sel.a11y.name].filter(Boolean).join(' / '));
        if(sel.redactions) L.push('- Redações de segredo: '+sel.redactions);
        var st=sel.computedStyles||{},ks=Object.keys(st); if(ks.length){ L.push('- Estilos computados:'); ks.forEach(function(k){ L.push('  - '+k+': '+st[k]); }); }
        if(sel.matchedCssRules&&sel.matchedCssRules.length){ L.push('- CSS aplicado detectado:'); sel.matchedCssRules.slice(0,8).forEach(function(r){ L.push('  - '+(r.href||'inline')+' :: '+r.selector); }); }
        L.push('','```html',sel.htmlSnippet||'','```','','Pedido neste item: '+(item.note||'(sem comentário específico)')); });
      const cm=designCoverageMd(cov); if(cm)L.push('',cm); return L.join('\n'); }
    async function sendDesignFeedback(){ if(!currentSession){ designStatus('Abra uma sessão antes de enviar o pacote.'); return; } if(!designSelections.length){ designStatus('Selecione pelo menos um elemento antes de enviar.'); return; } var note=(E.designNote.value||'').trim();
      var cov=await stopDesignCoverage(), artifactId=cacheDesignArtifact(designSelections,note,cov); var atts=[{name:'design-feedback.md',content:designFeedbackMd(designSelections,note,cov,artifactId)}];
      designSelections.forEach(function(item,idx){ var png=item.sel&&item.sel._png,b64=png?String(png).split(',')[1]:''; if(b64) atts.push({name:'design-selection-'+(idx+1)+'.png',content:b64,image:true,preview:png}); });
      try{ sendMsgTo(currentSession, note||'Corrija o elemento apontado no Design Feedback anexo.', atts); }
      catch(e){ designStatus('Falha ao enviar: '+((e&&e.message)||e)); return; }
      E.designNote.value=''; designSelections=[]; renderDesignSelections(); designStatus('Pacote enviado ao agente.'); }
    // Native wake-word fired. The native service can detect in the background; this WebView path can only
    // capture once the JS runtime is active and microphone access is allowed by the OS/browser.
    function playWakeCue(){ try{
      const C=window.AudioContext||window.webkitAudioContext; if(!C)return;
      const ac=new C(), osc=ac.createOscillator(), gain=ac.createGain(), now=ac.currentTime;
      osc.type='sine'; osc.frequency.value=880; gain.gain.setValueAtTime(0.0001,now);
      gain.gain.exponentialRampToValueAtTime(0.045,now+0.012); gain.gain.exponentialRampToValueAtTime(0.0001,now+0.13);
      osc.connect(gain).connect(ac.destination); osc.start(now); osc.stop(now+0.14); setTimeout(()=>{ try{ ac.close(); }catch(_e){} },260);
    }catch(e){} }
    function onNativeWake(){ try{
      tx({t:'wake_event',phase:'detected',sessionId:currentSession});
      status('listening',t('wakeDetected'));
      toast(t('wakeDetectedToast'));
      playWakeCue();
      try{ if(navigator.vibrate)navigator.vibrate([45,30,45]); }catch(_e){}
      if(typeof recording!=='undefined'&&recording) return;
      setTimeout(()=>startRec(true),240);
    }catch(e){} }
    // Drop OS-shared text into the composer (called by the native bridge's share-in handler).
    function applyShareIn(text){ try{ if(!text)return; var v=E.input.value; E.input.value=(v?v+'\n':'')+String(text); E.input.dispatchEvent(new Event('input')); E.input.focus(); toast(t('tShareIn')); }catch(e){} }
    // Biometric lock overlay (native only). Shown when cfg.bioLock; cleared once the OS confirms identity.
    async function maybeBioLock(){ if(!(window.__jarvisNative&&window.__jarvisNative.unlock&&cfg.bioLock)) return; if(bioOverlay||bioPrompting||Date.now()-bioUnlockedAt<5000) return;
      bioOverlay=document.createElement('div'); bioOverlay.className='biolock';
      bioOverlay.innerHTML='<div class="biolock-in"><div style="font-size:44px">🔒</div><div style="margin:10px 0 16px">Jarvis bloqueado</div><button type="button" id="bioUnlockBtn" class="primary">Desbloquear</button></div>';
      document.body.appendChild(bioOverlay);
      var overlay=bioOverlay;
      var go=async function(){ if(bioPrompting) return; bioPrompting=true; try{ if(await window.__jarvisNative.unlock()){ bioUnlockedAt=Date.now(); if(overlay&&overlay.parentNode) overlay.remove(); if(bioOverlay===overlay) bioOverlay=null; document.querySelectorAll('.biolock').forEach(function(x){ if(x!==bioOverlay) x.remove(); }); } } finally { bioPrompting=false; } };
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
    E.searchClose.onclick=()=>{ E.searchModal.classList.add('hidden'); restoreFocusAfterModal(E.searchModal); };
    E.searchInput.onkeydown=(e)=>{ if(e.key==='Enter'){ e.preventDefault(); clearTimeout(searchTimer); runSearch(); } };

    // ---------- Ctrl+F: busca CONTEXTUAL ----------
    // Roteia pelo que está na frente do usuário: arquivo aberto → busca NO arquivo; painel de arquivos
    // → filtra arquivos; chat aberto → busca NO chat; nada disso → pesquisa ENTRE sessões (modal atual).
    // Substitui o Ctrl+F nativo do navegador (preventDefault) por essa busca de dentro do app.
    let findState=null;  // { mode:'mark'|'files', container, bar, input, count, hits, idx }
    function findEscRx(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
    function findUnmark(c){ if(!c)return; c.querySelectorAll('mark.findhit').forEach(m=>{ const p=m.parentNode; if(p){ p.replaceChild(document.createTextNode(m.textContent),m); p.normalize(); } }); }
    function findMark(c,q){ findUnmark(c); const hits=[]; if(!q||!c)return hits; const rx=new RegExp(findEscRx(q),'gi');
      const nodes=[], w=document.createTreeWalker(c,NodeFilter.SHOW_TEXT,{acceptNode(n){ return n.nodeValue&&n.nodeValue.trim()&&!(n.parentElement&&n.parentElement.closest('.findbar'))?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT; }});
      let n; while(n=w.nextNode()) nodes.push(n);
      for(const node of nodes){ const s=node.nodeValue; rx.lastIndex=0; if(!rx.test(s))continue; rx.lastIndex=0;
        const frag=document.createDocumentFragment(); let last=0,m;
        while(m=rx.exec(s)){ if(m.index>last)frag.appendChild(document.createTextNode(s.slice(last,m.index))); const mk=document.createElement('mark'); mk.className='findhit'; mk.textContent=m[0]; frag.appendChild(mk); hits.push(mk); last=m.index+m[0].length; if(m.index===rx.lastIndex)rx.lastIndex++; }
        if(last<s.length)frag.appendChild(document.createTextNode(s.slice(last))); node.parentNode.replaceChild(frag,node); }
      return hits; }
    function findCountTxt(){ if(!findState)return; findState.count.textContent = findState.hits.length? (findState.idx+1)+'/'+findState.hits.length : (findState.input.value?'0/0':''); }
    function findGoto(delta){ if(!findState||!findState.hits.length)return; findState.hits.forEach(h=>h.classList.remove('cur')); const L=findState.hits.length; findState.idx=((findState.idx+delta)%L+L)%L; const h=findState.hits[findState.idx]; h.classList.add('cur'); if(h.scrollIntoView)h.scrollIntoView({block:'center',inline:'nearest'}); findCountTxt(); }
    function closeFind(){ if(!findState)return; if(findState.mode==='mark') findUnmark(findState.container); if(findState.mode==='files'){ filesQuery=''; renderFiles(); } if(findState.mt)clearTimeout(findState.mt); if(findState.bar&&findState.bar.parentNode)findState.bar.remove(); findState=null; }
    // Finder (modo 'finder', usado pela árvore): busca RECURSIVA de arquivos via `mention` (o mesmo
    // buscador fuzzy do "@", que varre dentro das pastas sob o cwd) — o destaque no DOM só via nós
    // renderizados, então não achava dentro de pasta fechada. Junta o caminho relativo ao cwd atual.
    function findFinderJoin(rel){ const sep=(curCwd||'').includes('\\')?'\\':'/'; return (curCwd||'').replace(/[\\/]$/,'')+sep+String(rel).replace(/\//g,sep); }
    function findFinderRender(files){ if(!findState||findState.mode!=='finder'||!findState.res)return; const res=findState.res; res.innerHTML='';
      findState.count.textContent=files.length?(files.length+(files.length>=40?'+':'')):'0';
      files.slice(0,40).forEach(rel=>{ const r=document.createElement('div'); r.className='findrow'; r.tabIndex=0; const nm=String(rel).split('/').pop();
        r.innerHTML='<b>'+esc(nm)+'</b> <span class="mut">'+esc(rel)+'</span>'; r.onclick=()=>{ openFile(findFinderJoin(rel)); closeFind(); }; res.appendChild(r); });
      if(!files.length){ const r=document.createElement('div'); r.className='findrow mut'; r.textContent='Nenhum arquivo.'; res.appendChild(r); } }
    function openFind(mode,container,label){
      if(findState){ if(findState.mode===mode&&findState.container===container){ findState.input.focus(); findState.input.select(); return; } closeFind(); }
      const bar=document.createElement('div'); bar.className='findbar'+(mode==='finder'?' finder':'');
      const inp=document.createElement('input'); inp.type='search'; inp.placeholder=(label||'Buscar')+'…'; inp.autocomplete='off'; inp.spellcheck=false;
      const cnt=document.createElement('span'); cnt.className='findcount';
      const btn=(t,tt,fn)=>{ const b=document.createElement('button'); b.type='button'; b.textContent=t; b.title=tt; b.onmousedown=e=>e.preventDefault(); b.onclick=fn; return b; };
      const row=document.createElement('div'); row.className='findrowtop'; row.appendChild(inp); row.appendChild(cnt);
      if(mode==='mark'){ row.appendChild(btn('‹','Anterior (Shift+Enter)',()=>findGoto(-1))); row.appendChild(btn('›','Próximo (Enter)',()=>findGoto(1))); }
      row.appendChild(btn('✕','Fechar (Esc)',closeFind)); bar.appendChild(row);
      let res=null; if(mode==='finder'){ res=document.createElement('div'); res.className='findres'; bar.appendChild(res); }
      document.body.appendChild(bar);
      findState={mode,container,bar,input:inp,count:cnt,res,hits:[],idx:-1,mt:null};
      inp.oninput=()=>{ if(mode==='files'){ filesQuery=inp.value; renderFiles(); const nn=filteredFiles().length; cnt.textContent=inp.value?(nn+' '+(nn===1?'arquivo':'arquivos')):''; }
        else if(mode==='finder'){ clearTimeout(findState.mt); const q=inp.value.trim(); if(!q){ res.innerHTML=''; cnt.textContent=''; return; } findState.mt=setTimeout(()=>tx({t:'mention',q}),150); }
        else { findState.hits=findMark(container,inp.value.trim()); findState.idx=-1; if(findState.hits.length)findGoto(1); else findCountTxt(); } };
      inp.onkeydown=(e)=>{ if(e.key==='Enter'){ e.preventDefault(); if(mode==='mark')findGoto(e.shiftKey?-1:1); else if(mode==='finder'){ const el=res&&res.querySelector('.findrow:not(.mut)'); if(el)el.click(); } else { const el=E.files.querySelector('.item'); if(el){ el.click(); closeFind(); } } }
        else if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); closeFind(); } };
      setTimeout(()=>{ inp.focus(); inp.select(); },20);
    }
    // Região onde o usuário ESTÁ (último clique/foco) decide o alvo do Ctrl+F. Sem isto, com chat +
    // arquivos na sidebar + visualizador abertos ao mesmo tempo, o chat sempre "vencia" e o painel de
    // arquivos / "fora de tudo" nunca eram alcançados. Atualizada em pointerdown/focusin (captura).
    let findRegion='chat';
    function updFindRegion(t){ if(!t||!t.closest)return;
      if(t.closest('.findbar')||t.closest('.modal'))return;           // interagir com a própria busca não muda a região
      if(t.closest('#filePanel')) findRegion='file';
      else if(t.closest('#filesPane')) findRegion='files';
      else if(t.closest('#treePanel')) findRegion='tree';
      else if(t.closest('#log')||t.closest('#composer')) findRegion='chat';
      else findRegion='none';                                          // sessões/header/vazio → busca ENTRE sessões
    }
    document.addEventListener('pointerdown',(e)=>updFindRegion(e.target),true);
    document.addEventListener('focusin',(e)=>updFindRegion(e.target),true);
    function ctrlFTarget(){
      const fileOpen = E.filePanel && !E.filePanel.classList.contains('hidden');
      const chatOK = currentSession!=null && E.log && E.log.childElementCount>0;
      if(findRegion==='file' && fileOpen) return ()=>openFind('mark',E.fileBody,'Buscar no arquivo');
      if(findRegion==='files') return ()=>openFind('files',E.files,'Filtrar arquivos');
      if(findRegion==='tree') return ()=>openFind('finder',E.treePanel,'Procurar arquivos (dentro das pastas)');
      if(findRegion==='chat' && chatOK) return ()=>openFind('mark',E.log,'Buscar no chat');
      if(findRegion==='none') return ()=>openSearch();
      // região indefinida (ainda sem clique) → decide por visibilidade
      if(fileOpen && !APP().classList.contains('tab-chat')) return ()=>openFind('mark',E.fileBody,'Buscar no arquivo');
      if(chatOK) return ()=>openFind('mark',E.log,'Buscar no chat');
      return ()=>openSearch();
    }
    document.addEventListener('keydown',(e)=>{
      if(!(e.ctrlKey||e.metaKey) || e.altKey || (e.key!=='f'&&e.key!=='F')) return;
      e.preventDefault(); e.stopPropagation();
      if(findState){ findState.input.focus(); findState.input.select(); return; }
      if(E.searchModal && !E.searchModal.classList.contains('hidden')){ E.searchInput.focus(); E.searchInput.select(); return; }
      ctrlFTarget()();
    }, true);
    // filtra ao digitar (debounce) — a 1ª busca parseia as sessões nativas, refinar o termo é instantâneo
    E.searchInput.oninput=()=>{ clearTimeout(searchTimer); const q=E.searchInput.value.trim(); if(!q){ E.searchResults.innerHTML=''; return; } if(searchMode==='semantic') return; searchTimer=setTimeout(runSearch,300); };
    E.searchResults.addEventListener('click',(e)=>{
      const refopen=e.target.closest('.refopen'); if(refopen){ e.stopPropagation(); if(refopen.dataset.runner){ routedMachine=refopen.dataset.runner; tx({t:'runner',runnerId:routedMachine}); } openSession(refopen.dataset.id,refopen.dataset.runner); E.searchModal.classList.add('hidden'); return; }
      const exec=e.target.closest('.exec'); if(exec){ e.stopPropagation(); launchSuggestionInNewSession(exec.dataset.action,{id:exec.dataset.id,runnerId:exec.dataset.runner}); E.searchModal.classList.add('hidden'); return; }
      const match=e.target.closest('.match'); if(match){ if(match.dataset.action){ e.stopPropagation(); launchSuggestionInNewSession(match.dataset.action,{id:match.dataset.id,runnerId:match.dataset.runner}); E.searchModal.classList.add('hidden'); return; } if(match.dataset.runner){ routedMachine=match.dataset.runner; tx({t:'runner',runnerId:routedMachine}); } openSession(match.dataset.id,match.dataset.runner); E.searchModal.classList.add('hidden'); } });

    let memoryPreviewToken='', memoryApplyToken='', memoryPreviewNote='', memoryApplyNote='';
    function showMemoryPreview(m){ memoryPreviewToken=m.token||''; memoryApplyToken=''; memoryPreviewNote=m.note||''; memoryApplyNote=''; E.memoryTarget.textContent=m.target||'—'; E.memoryNote.textContent=m.appendText||m.note||'';
      E.memoryMeta.textContent=(m.mode==='jarvis'?'Privada para seu usuário':'Arquivo de instruções do projeto')+' · expira em 5 minutos'; E.memoryCancel.disabled=false; E.memoryApply.disabled=!memoryPreviewToken; E.memoryModal.classList.remove('hidden'); }
    E.memoryCancel.onclick=()=>{ if(!memoryPreviewToken)return; E.memoryCancel.disabled=true; tx({t:'memory_cancel',token:memoryPreviewToken}); };
    E.memoryApply.onclick=()=>{ if(!memoryPreviewToken)return; memoryApplyToken=memoryPreviewToken; memoryApplyNote=memoryPreviewNote; memoryPreviewToken=''; E.memoryCancel.disabled=true; E.memoryApply.disabled=true; tx({t:'memory_apply',token:memoryApplyToken}); };

    // ---------- footer popovers (pills clicáveis) ----------
    let popMode=null, aiReturnAfterClose=false, aiReopenTimer=null;
    function reopenAiPopSoon(){
      aiReturnAfterClose=false;
      clearTimeout(aiReopenTimer);
      E.pop.classList.add('hidden');
      E.pop.classList.remove('usage-pop','ai-pop');
      E.pop.innerHTML='';
      E.pop._anchor=null;
      aiReopenTimer=setTimeout(()=>{ if(!E.aiBtn)return; buildAiPop(E.pop); E.pop.classList.remove('hidden'); E.pop._anchor=E.aiBtn; E.pop.scrollTop=0; placePop(); requestAnimationFrame(placePop); },0);
    }
    function closePop(){
      if(aiReturnAfterClose&&E.aiBtn&&!E.pop.classList.contains('hidden')){ reopenAiPopSoon(); return; }
      aiReturnAfterClose=false;
      E.pop.classList.add('hidden'); E.pop.classList.remove('usage-pop','ai-pop'); E.pop.innerHTML=''; E.pop._anchor=null; E.pop.style.left=''; E.pop.style.top=''; E.pop.style.maxHeight=''; popMode=null;
    }
    function cssPx(name){ const v=parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)); return Number.isFinite(v)?v:0; }
    function placePop(){
      if(E.pop.classList.contains('hidden')||!E.pop._anchor)return;
      const r=E.pop._anchor.getBoundingClientRect(), margin=8, safeTop=cssPx('--safe-top'), safeBottom=cssPx('--safe-bottom');
      const minY=safeTop+margin, maxY=innerHeight-safeBottom-margin;
      const above=Math.max(140,Math.floor(r.top-minY-margin)), below=Math.max(140,Math.floor(maxY-r.bottom-margin));
      const useAbove=above>=below, maxH=useAbove?above:below;
      E.pop.style.maxHeight=maxH+'px';
      const pr=E.pop.getBoundingClientRect();
      const left=Math.max(margin,Math.min(r.left, innerWidth-pr.width-margin));
      let top=useAbove?(r.top-pr.height-margin):(r.bottom+margin);
      if(top<minY)top=minY;
      if(top+pr.height>maxY)top=Math.max(minY,maxY-pr.height);
      E.pop.style.left=left+'px'; E.pop.style.top=top+'px';
    }
    function openPop(anchor,build){ closePop(); build(E.pop); E.pop.classList.remove('hidden'); E.pop._anchor=anchor; E.pop.scrollTop=0; placePop(); requestAnimationFrame(placePop); }
    function togglePop(anchor,build){ if(!E.pop.classList.contains('hidden') && E.pop._anchor===anchor) closePop(); else openPop(anchor,build); }
    function replaceOpenPop(anchor,build){ E.pop.classList.remove('usage-pop','ai-pop'); E.pop.innerHTML=''; build(E.pop); E.pop._anchor=anchor; E.pop.scrollTop=0; placePop(); requestAnimationFrame(placePop); }
    E.pop.addEventListener('click',e=>e.stopPropagation());
    document.addEventListener('click',(e)=>{ if(E.pop.classList.contains('hidden'))return; if(E.pop.contains(e.target)||(E.pop._anchor&&E.pop._anchor.contains(e.target)))return; aiReturnAfterClose=false; closePop(); });
    document.addEventListener('keydown',(e)=>{ if(e.key==='Escape'){ aiReturnAfterClose=false; closePop(); } });
    window.addEventListener('resize',placePop);
    const ph=(t)=>{ const d=document.createElement('div'); d.className='ph'; d.textContent=t; return d; };

    function machineAgents(){ const id=currentMachine==='all'?routedMachine:currentMachine, m=machines.find(x=>x.id===id); return m&&Array.isArray(m.agents)?m.agents:caps.map(c=>c.name); }
    // Orca #2: por padrão o picker mostra só as IAs que dá pra usar (linkadas/instaladas). As
    // realmente indisponíveis (não instaladas / sem login) ficam atrás de um "mostrar indisponíveis"
    // — não some pra sempre, só sai da frente. A IA atual sempre aparece, mesmo se ficou indisponível.
    let agentPopShowAll=false;
    function buildAgentPop(p){ p.innerHTML=''; p.appendChild(ph(currentSession==null?'Agente / IA padrão':'Agente / IA')); const avail=machineAgents(), pref=currentSession==null?{}:(sessionValue(sessionPrefs,currentSession,currentSessionRunner)||{}), prefKey=sessionStateKey(currentSession,currentSessionRunner);
      if(currentSession==null){ const n=document.createElement('div'); n.className='mut'; n.style.cssText='padding:0 2px 8px;font-size:11.5px'; n.textContent='Sem sessão aberta: esta escolha vira padrão para a próxima sessão.'; p.appendChild(n); }
      if(currentSession!=null&&!curStarted&&!curNative){ const a=document.createElement('div'); a.className='opt'+(pref.agent===AUTO_AGENT?' sel':''); a.innerHTML='✨ Automático'+(pref.agent===AUTO_AGENT?'<span class="r">atual</span>':''); a.onclick=()=>{ closePop(); const np=Object.assign({},pref,{agent:AUTO_AGENT,model:AUTO_MODEL,effort:AUTO_EFFORT}); sessionPrefs[prefKey]=np; saveSessionPrefs(); syncModelEffort(); }; p.appendChild(a); }
      const unusable=(c)=>(c.support==='not_installed'||c.support==='unauthenticated');
      const caps=machineCaps(); const hidden=caps.filter(c=>unusable(c)&&c.name!==currentAgent);
      caps.forEach(c=>{ if(!agentPopShowAll&&unusable(c)&&c.name!==currentAgent) return; const ok=avail.includes(c.name); const o=document.createElement('div'); o.className='opt'+(c.name===currentAgent?' sel':'')+(ok?'':' disabled');
        const state=c.support==='limited'?'limitado':c.support==='unverified'?'não verificado':c.support==='unauthenticated'?'sem login':c.support==='not_installed'?'não instalado':''; o.title=c.reason||'';
        o.innerHTML='🤖 '+esc(c.label||c.name)+(c.name===currentAgent?'<span class="r">atual</span>':(!ok?'<span class="r">indisponível</span>':(state?'<span class="r">'+esc(state)+'</span>':'')));
        if(ok) o.onclick=()=>{ closePop(); if(currentSession==null){ cfg.agent=c.name; currentAgent=c.name; saveCfg(); syncModelEffort(); return; } const prev=currentAgent, np=Object.assign({},pref,{agent:c.name}); sessionPrefs[prefKey]=np; saveSessionPrefs(); currentAgent=c.name; sessDeclModel=null; sessDeclEffort=null; syncModelEffort(); if(c.name!==prev) tx({t:'configure',sessionId:currentSession,agent:c.name}); else renderControls(); };
        p.appendChild(o); });
      if(hidden.length&&!agentPopShowAll){ const t=document.createElement('div'); t.className='opt mut'; t.style.fontSize='12px'; t.textContent='+ '+hidden.length+' indisponíve'+(hidden.length>1?'is':'l')+' (mostrar)'; t.onclick=()=>{ agentPopShowAll=true; buildAgentPop(p); }; p.appendChild(t); } }

    function buildModelPop(p){ const c=capsFor(currentAgent), control=modelControlOf(c), prefKey=sessionStateKey(currentSession,currentSessionRunner), defaultScope=currentSession==null; p.appendChild(ph(defaultScope?'Modelo padrão':'Modelo'));
      // Sincronizar (dono): rebusca o catálogo de TODAS as IAs (a atual primeiro) e realoca modelos
      // removidos para o mais próximo por família, mantendo o nível — nas configs de resumo/voz/rotinas.
      if(authUser&&authUser.role==='owner'){ const s=document.createElement('div'); s.className='opt'; s.style.cssText='border-bottom:1px solid var(--line);margin-bottom:4px'; s.innerHTML='↻ Sincronizar modelos <span class="mut" style="font-size:11px">catálogo + configs</span>'; s.title='Rebusca os modelos de todas as IAs (a atual primeiro) e ajusta as configurações que fixam um modelo para o candidato mais próximo por família, mantendo o mesmo nível'; s.onclick=()=>{ closePop(); toast('↻ Sincronizando modelos…'); tx({t:'sync_models',agent:currentAgent}); }; p.appendChild(s); }
      if(defaultScope){ const n=document.createElement('div'); n.className='mut'; n.style.cssText='padding:0 2px 8px;font-size:11.5px'; n.textContent='Sem sessão aberta: esta escolha vira padrão para a próxima sessão.'; p.appendChild(n); }
      if(control!=='per_turn'){ const n=document.createElement('div'); n.className='mut'; n.style.padding='10px'; n.textContent=control==='configuration_only'?'Este CLI define o modelo na própria configuração; o Jarvis não envia um modelo por turno.':'O provedor escolhe o modelo automaticamente.'; p.appendChild(n); return; } { const a=document.createElement('div'); a.className='opt'+(curModel==null?' sel':''); a.innerHTML='✨ Automático'+(curModel==null?'<span class="r">atual</span>':''); a.onclick=()=>{ closePop(); if(defaultScope){ cfg.model=''; cfg.effort=''; saveCfg(); syncModelEffort(); return; } const pref=Object.assign({},sessionValue(sessionPrefs,currentSession,currentSessionRunner)||{}); pref.model=AUTO_MODEL; sessionPrefs[prefKey]=pref; saveSessionPrefs(); syncModelEffort(); }; p.appendChild(a); } selectableModels(c).forEach(mm=>{ const o=document.createElement('div'); o.className='opt'+(mm.id===curModel?' sel':'');
      o.innerHTML=esc(mm.label||mm.id)+(mm.id===curModel?'<span class="r">atual</span>':'');
      o.onclick=()=>{ closePop(); const efs=effortsFor(currentAgent,mm.id); if(defaultScope){ cfg.model=mm.id; if(cfg.effort&&!efs.includes(cfg.effort))cfg.effort=''; saveCfg(); syncModelEffort(); return; } const pref=Object.assign({},sessionValue(sessionPrefs,currentSession,currentSessionRunner)||{}); pref.model=mm.id; if(pref.effort&&pref.effort!==AUTO_EFFORT&&!efs.includes(pref.effort))pref.effort=AUTO_EFFORT; sessionPrefs[prefKey]=pref; saveSessionPrefs(); syncModelEffort(); }; p.appendChild(o); }); }

    function buildEffortPop(p){ const efs=effortsFor(currentAgent,curModel); p.appendChild(ph('Esforço · '+(currentAgent||'')));
      if(!efs.length){ const d=document.createElement('div'); d.className='mut'; d.textContent='sem níveis para este modelo'; p.appendChild(d); return; }
      if(currentSession==null){ const n=document.createElement('div'); n.className='mut'; n.style.cssText='padding:0 2px 8px;font-size:11.5px'; n.textContent='Sem sessão aberta: este esforço vira padrão para a próxima sessão.'; p.appendChild(n); }
      const saveEffort=(value)=>{ curEffort=value; if(currentSession==null){ cfg.effort=value||''; saveCfg(); renderControls(); return; } const key=sessionStateKey(currentSession,currentSessionRunner), pref=Object.assign({},sessionValue(sessionPrefs,currentSession,currentSessionRunner)||{}); pref.effort=value==null?AUTO_EFFORT:value; sessionPrefs[key]=pref; saveSessionPrefs(); renderControls(); };
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

    function pickMode(mode){
      if(currentSession==null){ sdDoc.global=Object.assign({},sdDoc.global,{permissionMode:mode}); tx({t:'set_session_defaults',doc:sdDoc}); curMode=mode; renderControls(); return; }
      const key=sessionStateKey(currentSession,currentSessionRunner), pref=Object.assign({},sessionValue(sessionPrefs,currentSession,currentSessionRunner)||{});
      pref.permissionMode=mode; sessionPrefs[key]=pref; saveSessionPrefs(); curMode=mode;
      // Local: persist na hora via setmode. Remoto: sem round-trip de setmode — o modo viaja no próximo envio (opts).
      if(!currentSessionRunner||currentSessionRunner==='local') tx({t:'setmode',sessionId:currentSession,mode});
      renderControls();
    }
    function buildModePop(p){ p.appendChild(ph('Modo de permissão · '+(currentAgent||''))); const sup=supportedModesFor(currentAgent);
      if(currentSession==null){ const n=document.createElement('div'); n.className='mut'; n.style.cssText='padding:0 2px 8px;font-size:11.5px'; n.textContent='Sem sessão aberta: esta escolha vira o padrão global para novas sessões.'; p.appendChild(n); }
      ['manual','accept_edits','plan','auto','bypass'].forEach(mode=>{ const ok=sup.includes(mode); const o=document.createElement('div'); o.className='opt'+(curMode===mode?' sel':'')+(ok?'':' disabled');
        o.innerHTML='<span class="ailbl"><b>'+esc(MODE_LABELS[mode])+'</b><span>'+esc(MODE_DESC[mode]||'')+'</span></span>'+(curMode===mode?'<span class="r">atual</span>':(ok?'':'<span class="r">indisponível</span>'));
        if(ok) o.onclick=()=>{ closePop(); pickMode(mode); }; p.appendChild(o); }); }

    function buildAiPop(p){
      aiReturnAfterClose=false;
      p.classList.add('ai-pop');
      p.appendChild(ph('IA'));
      const valueOf=el=>((el&&el.textContent)||'—').trim()||'—';
      const openSub=(build,setup)=>{ if(setup)setup(); aiReturnAfterClose=true; replaceOpenPop(E.aiBtn,(root)=>{ build(root); const back=document.createElement('button'); back.type='button'; back.className='opt'; back.innerHTML='← IA <span class="r">voltar</span>'; back.onclick=(e)=>{ e.preventDefault(); e.stopPropagation(); aiReturnAfterClose=false; replaceOpenPop(E.aiBtn,buildAiPop); }; root.insertBefore(back,root.firstChild); }); };
      const add=(icon,label,value,disabled,fn)=>{
        const b=document.createElement('button');
        b.type='button';
        b.className='opt'+(disabled?' disabled':'');
        b.innerHTML='<span class="aiico">'+icon+'</span><span class="ailbl"><b>'+esc(label)+'</b><span>'+esc(value)+'</span></span>'+(disabled?'<span class="r">travado</span>':'<span class="r">abrir</span>');
        if(!disabled)b.onclick=(e)=>{ e.preventDefault(); e.stopPropagation(); fn(); };
        p.appendChild(b);
      };
      add('🤖','Agente / IA',valueOf(E.agentName),curStarted||curNative,()=>openSub(buildAgentPop,()=>{ agentPopShowAll=false; }));
      add('◈','Modelo',valueOf(E.modelName),false,()=>openSub(buildModelPop));
      add('⚡','Esforço',valueOf(E.effortName),false,()=>openSub(buildEffortPop));
      add('🛡','Modo',modeLabel(curMode),false,()=>openSub(buildModePop));
    }

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

    E.agentBtn.onclick=()=>{ if(curStarted||curNative)return; agentPopShowAll=false; togglePop(E.agentBtn,buildAgentPop); };
    if(E.aiBtn) E.aiBtn.onclick=()=>togglePop(E.aiBtn,buildAiPop);
    E.cwdBtn.onclick=()=>{ if(curStarted||curNative)return; togglePop(E.cwdBtn,buildFolderPop); };
    // ---------- árvore de arquivos (Orca #1) — explora a pasta da sessão, lazy por pasta ----------
    let treeMode=false; const treePending=new Map(); // path -> nó de pasta aguardando o `dirs`
    function treeJoin(base,name){ const sep=base.includes('\\')?'\\':'/'; return base.replace(/[\\/]$/,'')+sep+name; }
    function treeRunner(){ return routedMachine||sessionRunner()||'local'; }
    function makeFolderNode(fullpath,label,depth){
      const row=document.createElement('div'); row.className='trow'; row.style.paddingLeft=(depth*14+6)+'px';
      const tw=document.createElement('span'); tw.className='tw'; tw.textContent='▸';
      const ti=document.createElement('span'); ti.className='ti'; ti.textContent='📁';
      const tn=document.createElement('span'); tn.className='tn'; tn.textContent=label; tn.title=fullpath;
      row.append(tw,ti,tn);
      const children=document.createElement('div'); children.className='tchildren';
      const node={row,children,tw,fullpath,depth,loaded:false,open:false};
      row.onclick=()=>toggleFolder(node);
      return node;
    }
    function toggleFolder(node){
      if(!node.loaded){ node.tw.textContent='⏳'; treePending.set(node.fullpath,node); tx({t:'listdir',runnerId:treeRunner(),path:node.fullpath,files:true}); return; }
      node.open=!node.open; node.children.classList.toggle('open',node.open); node.tw.textContent=node.open?'▾':'▸';
    }
    function renderTreeChildren(node,m){
      node.loaded=true; node.open=true; node.tw.textContent='▾'; node.children.classList.add('open'); node.children.innerHTML='';
      const dirs=m.entries||[], files=m.files||[];
      if(!dirs.length && !files.length){ const e=document.createElement('div'); e.className='tempty'; e.style.paddingLeft=((node.depth+1)*14+6)+'px'; e.textContent='(vazio)'; node.children.appendChild(e); return; }
      dirs.forEach(name=>{ const child=makeFolderNode(treeJoin(m.path,name),name,node.depth+1); node.children.append(child.row,child.children); });
      files.forEach(name=>{ const r=document.createElement('div'); r.className='trow'; r.style.paddingLeft=((node.depth+1)*14+6)+'px';
        const ti=document.createElement('span'); ti.className='ti'; ti.textContent='📄'; const tn=document.createElement('span'); tn.className='tn'; tn.textContent=name; tn.title=treeJoin(m.path,name);
        // No desktop a árvore permanece aberta; no mobile o painel de arquivo precisa virar o foco.
        r.append(ti,tn); r.onclick=()=>{ treeSelectFile(r); openFile(treeJoin(m.path,name)); }; node.children.appendChild(r); });
    }
    function treeSelectFile(row){ E.treeBody.querySelectorAll('.trow.tsel').forEach(x=>x.classList.remove('tsel')); if(row) row.classList.add('tsel'); }
    function closeTree(){ E.treePanel.classList.add('hidden'); treeMode=false; cfg.treeOpen=false; saveCfg(); }
    function openTree(){ if(!E.treePanel.classList.contains('hidden')){ closeTree(); return; }   // clicar de novo fecha
      if(!curCwd){ toast('Abra uma sessão com uma pasta de trabalho para explorar os arquivos.'); return; }
      treeMode=true; treePending.clear(); E.treePanel.classList.remove('hidden'); E.treeRootPath.textContent=curCwd; E.treeRootPath.title=curCwd; E.treeBody.innerHTML='';
      const root=makeFolderNode(curCwd, curCwd.split(/[\\/]/).filter(Boolean).pop()||curCwd, 0); E.treeBody.append(root.row,root.children); toggleFolder(root);
      cfg.treeOpen=true; saveCfg(); }
    if(E.treeBtn) E.treeBtn.onclick=openTree;
    if(E.treeClose) E.treeClose.onclick=closeTree;
    if(E.termBtn) E.termBtn.onclick=()=>openTermPanel(true);
    if(E.termMenuBtn) E.termMenuBtn.onclick=()=>{ closeSide(); openTermPanel(true); };
    if(E.termNew) E.termNew.onclick=newTerminal;
    if(E.termClose) E.termClose.onclick=closeTermPanel;
    if(E.termMax) E.termMax.onclick=()=>{ E.termPanel.classList.toggle('max'); setTimeout(()=>{ const rec=termMap[termActive]; if(rec)termFit(rec); },50); };
    // restaura a árvore aberta após carregar uma sessão com pasta (persistência visual)
    function maybeRestoreTree(){ if(cfg.treeOpen && curCwd && E.treePanel.classList.contains('hidden')){ openTree(); } }
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
    function buildUsagePop(p){ popMode='usage'; p.classList.add('usage-pop'); const c=modelContext();
      let h='<div class="upop"><div class="uh">Janela de contexto</div>';
      if(c&&lastInputTokens){ const pc=ctxPct(); h+=`<div class="urow"><span>${kfmt(lastInputTokens)} / ${kfmt(c)}</span><b>${pc}%</b></div>`+ubar(pc, pc>85?'#f85149':pc>60?'#e3b341':'#3fb950'); }
      else h+='<div class="umut">envie uma mensagem para medir</div>';
      h+='<div class="uh" style="margin-top:12px">Custo da sessão</div><div id="usessc">'+sessCostRow()+'</div>';
      h+='<div class="uh" style="margin-top:12px">Limites do plano</div><div id="uplan" class="umut uloading">consultando o provedor…</div></div>';
      const usageRunner=currentMachine==='all'?routedMachine:currentMachine, usageAgent=currentAgent||availableMachineCaps()[0]?.name||caps[0]?.name||'';
      p.innerHTML=h; if(planKey===usageRunner+'\0'+usageAgent) renderPlan(planUsage); tx({t:'get_usage',agent:usageAgent,runnerId:usageRunner}); }
    function renderPlan(plan){ const el=document.getElementById('uplan'); if(!el)return;
      if(!plan){ el.className='umut'; el.textContent=planStatus==='unsupported'?'o CLI desta IA não publica limites de conta':planStatus==='error'?'erro ao consultar o provedor':'nenhum limite foi reportado pelo provedor'; requestAnimationFrame(placePop); return; }
      const w=(lbl,x,color)=> x?`<div class="urow"><span>${esc(lbl)}</span><b>${planPctText(x)}</b></div>`+ubar(planUsed(x),color)+(x.resetsAt?`<div class="umut ureset">reinicia ${fmtReset(x.resetsAt)}</div>`:''):'';
      let h=w('Limite de 5 horas',plan.fiveHour,'#2563eb')+w('Semanal · todos os modelos',plan.sevenDay,'#7c3aed');
      (plan.extra||[]).forEach(e=>h+=w(e.label,e,'#7c3aed'));
      if(plan.source) h+=`<div class="umut">fonte: ${esc(plan.source)}</div>`;
      el.className=''; el.innerHTML=h||'<span class="umut">sem dados</span>'; requestAnimationFrame(placePop); }
    E.usageBtn.onclick=()=>togglePop(E.usageBtn,buildUsagePop);

    // ---------- personal assistant / local-first context ----------
    let personalState=null, personalSuggestions=[], personalActiveAction=null, personalActiveActionNote='', personalCalendarEditContext=null, personalSourceEditing='', personalSourceEditingConfig={}, personalFavoriteEditing='', personalFavoriteSource=null, personalResolvedRegion=null, personalLocationReadyUntil=0, personalVehicleEditing='', personalPreferenceEditing='', personalPreferenceCorrectionId='', personalMapInstance=null, personalMapModule=null, personalPmtilesProtocol=null, personalModalReturnFocus=null, personalCalendarEditReturnFocus=null, personalActionReturnFocus=null;
    let personalActionAckTimer=null, personalActionAckWatchKey='', personalActionAckChecks=0, personalActionAckExhausted=false;
    let personalNativeCapabilities=null, personalNativePermissions=null, personalNativeTransitionListener=null, personalNativeInit=null, personalNativeDrainPromise=null, personalNativeTransitionCount=0, personalNativeGeofenceConfigured=false;
    let pendingPersonalDeepLink='', lastPersonalDeepLink='', lastPersonalDeepLinkAt=0, personalOpenedFeedbackScope='', personalOpenedFeedbackIds=new Set();
    const personalPending=new Map();
    const personalSilentSuggestionRequests=new Set();
    const personalPreferenceDecisionsPending=new Set();
    const personalNotificationFeedbackQueues=new Map();
    const personalSourceEnvironment=new Map();
    let personalSourceConfiguredEnvNames=new Set();
    const personalPurposeLabels={nearby:['Locais próximos','Nearby places','Lugares cercanos'],mobility:['Mobilidade','Mobility','Movilidad'],calendar:['Agenda','Calendar','Agenda'],events:['Eventos','Events','Eventos'],weather:['Clima','Weather','Clima'],automation:['Automação','Automation','Automatización']};
    const personalRiskLabels={read:['Leitura','Read','Lectura'],local_reversible:['Local e reversível','Local and reversible','Local y reversible'],external_reversible:['Externa e reversível','External and reversible','Externa y reversible'],consequential:['Consequente','Consequential','Consecuente']};
    const personalText=(values)=>values[lang==='en'?1:lang==='es'?2:0];
    const personalReqId=()=>{ try{return crypto.randomUUID();}catch(e){return'p'+Date.now()+Math.random().toString(36).slice(2);} };
    function personalRequest(frame,timeoutMs=20000){ return new Promise((resolve,reject)=>{ const requestId=frame.requestId||personalReqId(); frame.requestId=requestId;
      const timer=setTimeout(()=>{ personalPending.delete(requestId); reject(new Error(personalText(['Sem resposta do assistente.','No response from the assistant.','Sin respuesta del asistente.']))); },timeoutMs);
      personalPending.set(requestId,{resolve,reject,timer}); tx(frame); }); }
    async function personalContextQuery(query,{silent=false,timeoutMs=30000}={}){const requestId=personalReqId();if(silent)personalSilentSuggestionRequests.add(requestId);try{return await personalRequest({t:'personal_context_query',requestId,query},timeoutMs);}finally{personalSilentSuggestionRequests.delete(requestId);}}
    function personalSettle(m,error){ const pending=m&&personalPending.get(m.requestId); if(!pending)return; clearTimeout(pending.timer); personalPending.delete(m.requestId); (error?pending.reject:pending.resolve)(error||m); }
    function personalError(error){ const message=String((error&&error.message)||error||personalText(['Falha no assistente pessoal.','Personal assistant failed.','Falló el asistente personal.'])); toast('⚠ '+message); if(E.personalQueryStatus)E.personalQueryStatus.textContent=message; }
    function requestPersonalState(){ return personalRequest({t:'personal_context_get',requestId:personalReqId()}).catch(personalError); }
    function personalDeviceMarkerKey(){return'jarvis_personal_device:'+(authUser&&authUser.id||'local');}
    function readPersonalDeviceMarker(){try{return JSON.parse(localStorage.getItem(personalDeviceMarkerKey())||'null');}catch(e){return null;}}
    function writePersonalDeviceMarker(value){try{localStorage.setItem(personalDeviceMarkerKey(),JSON.stringify(value));}catch(e){}}
    function personalDeviceLocale(){return String(lang||navigator.language||'pt').replace('_','-').slice(0,35);}
    function personalDeviceTimeZone(){try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';}catch(e){return'UTC';}}
    function personalDeviceNotificationPolicyFromControls(){const values=[E.personalQuietStart.value,E.personalQuietEnd.value,E.personalMaxPerDay.value,E.personalCooldown.value,E.personalMinScore.value],policy={quietStart:values[0],quietEnd:values[1],maxPerDay:Number(values[2]),cooldownMinutes:Number(values[3]),minScore:Number(values[4])},clock=/^(?:[01]\d|2[0-3]):[0-5]\d$/;if(values.some(value=>String(value).trim()==='')||!clock.test(policy.quietStart)||!clock.test(policy.quietEnd)||!Number.isSafeInteger(policy.maxPerDay)||policy.maxPerDay<0||policy.maxPerDay>50||!Number.isSafeInteger(policy.cooldownMinutes)||policy.cooldownMinutes<0||policy.cooldownMinutes>10080||!Number.isFinite(policy.minScore)||policy.minScore<0||policy.minScore>1)throw new Error(t('invalidDeviceNotificationPolicy'));return policy;}
    function personalCurrentDeviceProfile(){const marker=readPersonalDeviceMarker(),rows=personalState&&personalState.deviceProfiles||[],remember=row=>{writePersonalDeviceMarker({...row,disabledProactiveKinds:[...(row.disabledProactiveKinds||[])],...(row.notifications?{notifications:{...row.notifications}}:{})});return row;};if(marker&&marker.deviceId){const found=rows.find(row=>row.deviceId===marker.deviceId);if(found)return remember(found);}if(marker){const localRows=rows.filter(row=>row.locale===marker.locale&&row.timeZone===marker.timeZone);if(localRows.length===1)return remember(localRows[0]);const matches=localRows.filter(row=>row.proactiveEnabled===marker.proactiveEnabled&&(!marker.updatedAt||row.updatedAt===marker.updatedAt));if(matches.length===1)return remember(matches[0]);return marker;}const matches=rows.filter(row=>row.locale===personalDeviceLocale()&&row.timeZone===personalDeviceTimeZone());if(matches.length===1)return remember(matches[0]);return null;}
    function rememberPersonalDeviceProfile(previous,result,desired){const marker=readPersonalDeviceMarker(),before=new Map((previous||[]).map(row=>[row.deviceId,row.updatedAt])),rows=result&&result.state&&result.state.deviceProfiles||personalState&&personalState.deviceProfiles||[],matches=rows.filter(row=>row.locale===desired.locale&&row.timeZone===desired.timeZone&&row.proactiveEnabled===desired.proactiveEnabled&&before.get(row.deviceId)!==row.updatedAt).sort((a,b)=>b.updatedAt-a.updatedAt),known=marker&&rows.find(row=>row.deviceId===marker.deviceId),fallback=rows.filter(row=>row.locale===desired.locale&&row.timeZone===desired.timeZone&&row.proactiveEnabled===desired.proactiveEnabled),row=matches[0]||known||(fallback.length===1?fallback[0]:null),notifications=row&&row.notifications||desired.notifications||marker&&marker.notifications;writePersonalDeviceMarker({deviceId:row&&row.deviceId,locale:desired.locale,timeZone:desired.timeZone,proactiveEnabled:desired.proactiveEnabled,disabledProactiveKinds:[...(row&&row.disabledProactiveKinds||desired.disabledProactiveKinds||marker&&marker.disabledProactiveKinds||[])],...(notifications?{notifications:{...notifications}}:{}),updatedAt:row&&row.updatedAt||Date.now()});}
    async function personalPutCurrentDeviceProfile(overrides={}){if(!personalState)await requestPersonalState();if(!personalState)throw new Error(personalText(['Contexto pessoal indisponível.','Personal context unavailable.','Contexto personal no disponible.']));const previous=personalState.deviceProfiles||[],current=personalCurrentDeviceProfile(),profile={locale:personalDeviceLocale(),timeZone:personalDeviceTimeZone(),proactiveEnabled:Object.prototype.hasOwnProperty.call(overrides,'proactiveEnabled')?!!overrides.proactiveEnabled:!!(current&&current.proactiveEnabled)};if(Array.isArray(overrides.disabledProactiveKinds))profile.disabledProactiveKinds=[...new Set(overrides.disabledProactiveKinds.map(String).filter(Boolean))].slice(0,50);if(overrides.notifications&&typeof overrides.notifications==='object')profile.notifications={...overrides.notifications};const result=await personalRequest({t:'personal_device_update',requestId:personalReqId(),revision:personalState.revision,profile});rememberPersonalDeviceProfile(previous,result,profile);return result;}
    async function personalEnableProactiveKind(kind){try{const profile=personalCurrentDeviceProfile(),disabled=(profile&&profile.disabledProactiveKinds||[]).filter(value=>value!==kind);await personalPutCurrentDeviceProfile({disabledProactiveKinds:disabled,proactiveEnabled:!!(profile&&profile.proactiveEnabled)});renderPersonalDeviceProfile();toast(t('kindEnabled'));}catch(e){personalError(e);}}
    function personalProactiveKindLabel(kind){return kind==='weather_risk_estimate'?t('weatherRiskEstimate'):kind==='weather_alert'?t('officialWeatherAlert'):String(kind||'');}
    function renderPersonalDeviceProfile(){if(!E.personalProactiveEnabled)return;const profile=personalCurrentDeviceProfile(),enabled=!!(profile&&profile.proactiveEnabled),disabled=[...new Set(profile&&profile.disabledProactiveKinds||[])],hasOverride=!!(profile&&profile.notifications),policy=hasOverride?profile.notifications:personalState&&personalState.settings&&personalState.settings.notifications;if(policy){E.personalQuietStart.value=policy.quietStart;E.personalQuietEnd.value=policy.quietEnd;E.personalMaxPerDay.value=policy.maxPerDay;E.personalCooldown.value=policy.cooldownMinutes;E.personalMinScore.value=policy.minScore;}E.personalProactiveEnabled.checked=enabled;if(E.personalProactiveStatus)E.personalProactiveStatus.textContent=t(enabled?'proactiveDeviceOn':'proactiveDeviceOff');if(E.personalProactivePolicyStatus)E.personalProactivePolicyStatus.textContent=t(hasOverride?'proactiveDevicePolicyOverride':'proactiveDevicePolicyFallback');if(!E.personalDisabledKinds)return;E.personalDisabledKinds.innerHTML='';if(!disabled.length)return;const label=document.createElement('span');label.className='personal-note';label.textContent=t('disabledKinds')+':';E.personalDisabledKinds.appendChild(label);disabled.forEach(kind=>{const item=document.createElement('span');item.className='personal-disabled-kind';const value=document.createElement('span'),kindLabel=personalProactiveKindLabel(kind);value.textContent=kindLabel;const button=personalButton(t('enableKind'),()=>personalEnableProactiveKind(kind));button.setAttribute('aria-label',`${t('enableKind')}: ${kindLabel}`);item.append(value,button);E.personalDisabledKinds.appendChild(item);});}
    function personalSourcePurposes(type){ return ({device_location:['nearby','mobility','events','weather'],nominatim:['nearby'],valhalla:['mobility'],osm:['nearby'],open_charge_map:['nearby','mobility'],open_meteo:['weather'],weather_alerts:['weather'],mapas_culturais:['events'],open_events:['events'],device_calendar:['calendar'],caldav:['calendar'],mcp_http:['nearby','mobility','calendar','events','weather','automation'],mcp_stdio:['nearby','mobility','calendar','events','weather','automation'],home_assistant:['automation']})[type]||[]; }
    function personalPurposeName(p){ const row=personalPurposeLabels[p]||[p,p,p]; return personalText(row); }
    function personalSourceName(id){ if(id==='device-location')return personalText(['Localização deste aparelho','This device location','Ubicación de este dispositivo']);if(id==='device-calendar')return personalText(['Agenda deste aparelho','This device calendar','Agenda de este dispositivo']); const source=personalState&&personalState.sources.find(x=>x.id===id); if(source)return source.label; const st=personalState&&personalState.sourceStatuses.find(x=>x.descriptor.id===id); return st?st.descriptor.label:id; }
    function personalActiveConsents(sourceId){ const now=Date.now(); return (personalState&&personalState.consents||[]).filter(c=>c.sourceId===sourceId&&!c.revokedAt&&(!c.expiresAt||c.expiresAt>now)); }
    function personalSourceIsPaused(sourceId){return!!(personalState&&personalState.settings&&Array.isArray(personalState.settings.pausedSourceIds)&&personalState.settings.pausedSourceIds.includes(sourceId));}
    function personalSourceRequiresDetails(row){return !!(row&&row.type==='caldav'&&row.connection&&row.connection.config&&row.connection.config.access==='details');}
    function personalSourceHasField(sourceId,field){return personalActiveConsents(sourceId).some(consent=>(consent.fields||[]).includes(field));}
    function personalStatusLabel(state){ return ({ready:['Pronta','Ready','Lista'],degraded:['Degradada','Degraded','Degradada'],offline:['Offline','Offline','Sin conexión'],paused:['Pausada','Paused','Pausada'],unconfigured:['Não configurada','Unconfigured','Sin configurar'],uncertified:['Não certificada','Uncertified','No certificada']})[state]||[state,state,state]; }
    function personalButton(textValue,fn,cls='ghost'){ const b=document.createElement('button'); b.type='button'; b.className=cls; b.textContent=textValue; b.onclick=fn; return b; }
    const personalReferencePurposes=new Set(['nearby','mobility','events','weather']);
    function personalPurposeNeedsReference(purpose=E.personalPurpose&&E.personalPurpose.value){return personalReferencePurposes.has(purpose);}
    function personalHasCurrentLocation(purpose=E.personalPurpose&&E.personalPurpose.value){return !personalPurposeNeedsReference(purpose)||(personalLocationReadyUntil>Date.now()&&personalState&&personalState.settings.locationMode!=='off'&&personalConsentHasField(purpose,'position'));}
    function personalReferenceUi(){
      if(!E.personalReference)return;const relevant=personalPurposeNeedsReference(),panel=E.personalReference.closest('.personal-query-reference'),region=relevant&&E.personalReference.value==='region',hasLocation=personalHasCurrentLocation();
      if(panel)panel.classList.toggle('hidden',!relevant);E.personalLocate.classList.toggle('hidden',!relevant);E.personalRegionRow.classList.toggle('hidden',!region);E.personalRegionResolve.classList.toggle('hidden',!region);if(!region)E.personalRegionResults.classList.add('hidden');
      const fallback=!hasLocation&&relevant,key=E.personalReference.value.startsWith('favorite:')?'referenceFavoriteActive':region?'referenceRegionActive':'referenceFallback';E.personalReferenceHint.textContent=t(key);E.personalReferenceHint.classList.toggle('hidden',!fallback);if(!relevant)E.personalRegionResults.classList.add('hidden');
    }
    function renderPersonalReferenceOptions(){
      if(!E.personalReference)return;const selected=E.personalReference.value||'auto',purpose=E.personalPurpose.value,relevant=personalPurposeNeedsReference(purpose);E.personalReference.innerHTML='';
      const automatic=document.createElement('option');automatic.value='auto';automatic.textContent=t('referenceAutomatic');E.personalReference.appendChild(automatic);
      const favorites=(personalState&&personalState.favorites||[]).filter(favorite=>(favorite.purposes||[]).includes(purpose));if(favorites.length){const group=document.createElement('optgroup');group.label=t('favoriteReferences');favorites.forEach(favorite=>{const option=document.createElement('option');option.value=`favorite:${favorite.id}`;option.textContent=favorite.label;group.appendChild(option);});E.personalReference.appendChild(group);}
      const region=document.createElement('option');region.value='region';region.textContent=t('referenceRegion');E.personalReference.appendChild(region);
      const available=[...E.personalReference.options].map(option=>option.value),next=!relevant?'auto':available.includes(selected)?selected:'auto';E.personalReference.value=next;personalReferenceUi();
    }
    function personalCandidateAddress(suggestion){const data=suggestion&&suggestion.candidate&&suggestion.candidate.data||{},address=data.displayName??data.address??data.locationName??'';if(typeof address==='string')return address.slice(0,500);if(address&&typeof address==='object'){const values=Object.values(address).map(String).filter(Boolean);return values.join(', ').slice(0,500);}return'';}
    function personalSuggestionPoint(suggestion){const point=suggestion&&suggestion.candidate&&suggestion.candidate.point,lat=Number(point&&point.lat),lng=Number(point&&point.lng);return Number.isFinite(lat)&&lat>=-90&&lat<=90&&Number.isFinite(lng)&&lng>=-180&&lng<=180?{lat,lng,...(Number.isFinite(Number(point.accuracyM))?{accuracyM:Number(point.accuracyM)}:{})}:null;}
    function personalSuggestionSource(suggestion){const source=suggestion&&suggestion.sources&&suggestion.sources[0];return source&&typeof source.sourceId==='string'?{...source}:null;}
    async function personalGeocodeCandidates(text){
      const query=String(text||'').trim();if(!query)return[];
      const result=await personalContextQuery({purpose:'nearby',text:query,locale:lang,limit:10,filters:{layer:'address'}},{silent:true});
      const seen=new Set();return(result.suggestions||[]).filter(suggestion=>{const point=personalSuggestionPoint(suggestion);if(!point)return false;const key=`${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,10);
    }
    function renderPersonalPlaceChoices(container,rows,{emptyKey,actionKey,onSelect}){container.innerHTML='';container.classList.toggle('hidden',!rows.length);if(!rows.length){const empty=document.createElement('span');empty.className='personal-note';empty.textContent=t(emptyKey);container.appendChild(empty);container.classList.remove('hidden');return;}rows.forEach(suggestion=>{const title=String(suggestion.candidate&&suggestion.candidate.title||''),address=personalCandidateAddress(suggestion),button=personalButton('',()=>onSelect(suggestion),'ghost personal-choice'),heading=document.createElement('b'),meta=document.createElement('span');heading.textContent=title;meta.textContent=[address,t(actionKey)].filter(Boolean).join(' · ');button.setAttribute('aria-label',`${t(actionKey)}: ${title}`);button.append(heading,meta);container.appendChild(button);});}
    async function resolvePersonalRegion(){
      const textValue=E.personalRegion.value.trim();if(!textValue){personalError(new Error(t('regionOrAddress')));return[];}E.personalRegionResolve.disabled=true;E.personalQueryStatus.textContent=personalText(['Localizando região...','Finding region...','Localizando región...']);personalResolvedRegion=null;
      try{const rows=await personalGeocodeCandidates(textValue),selectRegion=suggestion=>{personalResolvedRegion={queryText:E.personalRegion.value.trim(),point:personalSuggestionPoint(suggestion),label:String(suggestion.candidate.title||''),source:personalSuggestionSource(suggestion)};E.personalRegionResults.classList.add('hidden');E.personalQueryStatus.textContent=`${t('regionResolved')}: ${personalResolvedRegion.label}`;};renderPersonalPlaceChoices(E.personalRegionResults,rows,{emptyKey:'noRegions',actionKey:'chooseRegion',onSelect:selectRegion});if(rows.length===1)selectRegion(rows[0]);return rows;}catch(e){personalError(e);return[];}finally{E.personalRegionResolve.disabled=false;}
    }
    function renderPersonalSources(){ if(!E.personalSourceList||!personalState)return; const rows=new Map();
      const deviceContext=personalState.deviceContext||{},locationContext=deviceContext.location,calendarContext=deviceContext.calendar;
      rows.set('device-location',{id:'device-location',label:personalSourceName('device-location'),type:'device_location',purposes:personalSourcePurposes('device_location'),transport:'device',costClass:'local',certification:'first_party',state:personalState.settings.locationMode==='off'?'paused':locationContext?locationContext.needsSync?'degraded':'ready':'unconfigured',context:locationContext});
      rows.set('device-calendar',{id:'device-calendar',label:personalSourceName('device-calendar'),type:'device_calendar',purposes:personalSourcePurposes('device_calendar'),transport:'device',costClass:'local',certification:'first_party',state:calendarContext?calendarContext.needsSync?'degraded':'ready':'unconfigured',context:calendarContext});
      personalState.sourceStatuses.forEach(s=>rows.set(s.descriptor.id,{...s.descriptor,state:s.state,message:s.message,status:s}));
      personalState.sources.forEach(s=>{ const current=rows.get(s.id)||{}; rows.set(s.id,{...current,id:s.id,label:s.label,type:s.type,purposes:current.purposes||personalSourcePurposes(s.type),transport:current.transport||(s.type==='mcp_stdio'?'stdio':'http'),costClass:current.costClass||(s.type==='mcp_stdio'||s.type==='device_calendar'?'local':'free'),certification:current.certification||'uncertified',state:current.state||(s.enabled?'unconfigured':'paused'),connection:s}); });
      E.personalSourceList.innerHTML=''; if(!rows.size){E.personalSourceList.textContent=personalText(['Nenhuma fonte disponível.','No sources available.','No hay fuentes disponibles.']);return;}
      rows.forEach(row=>{ const item=document.createElement('div'); item.className='personal-row'; const main=document.createElement('div'); main.className='personal-row-main'; const title=document.createElement('b'); title.textContent=row.label||row.id; const meta=document.createElement('span'); meta.className='personal-meta';
        const paused=personalSourceIsPaused(row.id),status=personalText(personalStatusLabel(paused?'paused':row.state||'unconfigured')),health=row.status||{}; meta.textContent=[status,row.costClass==='local'?personalText(['local','local','local']):personalText(['gratuita','free','gratuita']),row.transport,Number.isFinite(health.latencyMs)?`${health.latencyMs} ms`:'',(row.purposes||[]).map(personalPurposeName).join(', ')].filter(Boolean).join(' · '); main.append(title,meta);if(health.lastSuccessAt){const last=document.createElement('span');last.className='personal-meta';last.textContent=personalText(['Último sucesso: ','Last success: ','Último éxito: '])+new Date(health.lastSuccessAt).toLocaleString();main.appendChild(last);}
        if(row.context){const sync=document.createElement('span'),observedAt=Number(row.context.observedAt),expiresAt=Number(row.context.expiresAt),observedLabel=Number.isFinite(observedAt)?new Date(observedAt).toLocaleString():t('dataUnknown'),expiresLabel=Number.isFinite(expiresAt)?new Date(expiresAt).toLocaleString():t('dataUnknown');sync.className='personal-meta';sync.textContent=row.context.needsSync?personalText([`Sincronização necessária; última atualização ${observedLabel}.`,`Synchronization required; last update ${observedLabel}.`,`Sincronización necesaria; última actualización ${observedLabel}.`]):personalText([`Sincronizado; válido até ${expiresLabel}.`,`Synchronized; valid until ${expiresLabel}.`,`Sincronizado; válido hasta ${expiresLabel}.`]);main.appendChild(sync);}if(row.message){const msg=document.createElement('span');msg.className='personal-meta';msg.textContent=row.message;main.appendChild(msg);} const acts=document.createElement('div'); acts.className='personal-row-actions'; const consents=personalActiveConsents(row.id),needsDetails=personalSourceRequiresDetails(row),hasDetails=personalSourceHasField(row.id,'details');
        if(!consents.length)acts.appendChild(personalButton(needsDetails?t('authorizeDetails'):personalText(['Autorizar','Authorize','Autorizar']),()=>needsDetails?personalGrantCalDavDetails(row):personalGrantSource(row.id,row.purposes||[])));
        else{if(needsDetails&&!hasDetails)acts.appendChild(personalButton(t('authorizeDetails'),()=>personalGrantCalDavDetails(row)));acts.appendChild(personalButton(personalText(['Revogar','Revoke','Revocar']),()=>personalRevokeSource(row.id)));}
        if(row.id==='device-calendar'&&consents.length&&!paused)acts.appendChild(personalButton(personalText(['Sincronizar','Synchronize','Sincronizar']),async()=>{try{await putPersonalCalendar(true);await requestPersonalState();toast(personalText(['Agenda sincronizada.','Calendar synchronized.','Calendario sincronizado.']));}catch(e){personalError(e);}}));if(authUser&&authUser.role==='owner'){acts.appendChild(personalButton(paused?personalText(['Retomar','Resume','Reanudar']):personalText(['Pausar','Pause','Pausar']),()=>personalToggleSourcePause(row.id)));}if(row.connection&&authUser&&authUser.role==='owner'&&['caldav','mcp_http','mcp_stdio'].includes(row.connection.type)){const discoverButton=personalButton(t('discoverSource'),()=>personalDiscoverSource(row,discoverButton));acts.appendChild(discoverButton);}if(authUser&&authUser.role==='owner'&&row.id!=='device-location'&&row.id!=='device-calendar'){const testButton=personalButton(t('testSource'),()=>personalTestSource(row,testButton));acts.appendChild(testButton);}if(row.connection&&authUser&&authUser.role==='owner'){ acts.appendChild(personalButton(t('edit'),()=>personalEditSource(row.connection))); acts.appendChild(personalButton(t('remove'),()=>personalDeleteSource(row.connection),'ghost personal-danger')); }
        item.append(main,acts); E.personalSourceList.appendChild(item); });
      renderPersonalConsents(); }
    function renderPersonalConsents(){ if(!E.personalConsentList||!personalState)return; E.personalConsentList.innerHTML=''; const rows=(personalState.consents||[]).filter(c=>!c.revokedAt&&(!c.expiresAt||c.expiresAt>Date.now()));
      if(!rows.length){E.personalConsentList.textContent=personalText(['Nenhum consentimento ativo.','No active consent.','No hay consentimientos activos.']);return;}
      rows.forEach(c=>{const item=document.createElement('div');item.className='personal-row';const main=document.createElement('div');main.className='personal-row-main';const b=document.createElement('b');b.textContent=personalSourceName(c.sourceId);const meta=document.createElement('span');meta.className='personal-meta',fields=(c.fields||[]).filter(field=>field!=='*').map(field=>field==='details'?t('calendarDetailsField'):field);meta.textContent=[c.purposes.map(personalPurposeName).join(', '),fields.length?`${t('consentFields')}: ${fields.join(', ')}`:'',c.expiresAt?new Date(c.expiresAt).toLocaleString():''].filter(Boolean).join(' · ');main.append(b,meta);item.append(main,personalButton(personalText(['Revogar','Revoke','Revocar']),()=>personalRevokeConsent(c.id),'ghost personal-danger'));E.personalConsentList.appendChild(item);}); }
    function renderPersonalVehicles(){if(!E.personalVehicleList||!personalState)return;E.personalVehicleList.innerHTML='';const rows=personalState.vehicleProfiles||[];rows.forEach(profile=>{const row=document.createElement('div');row.className='personal-row';const main=document.createElement('div');main.className='personal-row-main';const title=document.createElement('b');title.textContent=(profile.isDefault?'★ ':'')+(profile.label||profile.id);const meta=document.createElement('span');meta.className='personal-meta';meta.textContent=[`ID: ${profile.id}`,(profile.connectorTypeIds||[]).length?`OCM: ${profile.connectorTypeIds.join(', ')}`:'',profile.maxAcceptedPowerKw?`${profile.maxAcceptedPowerKw} kW`:'',profile.rangeKm?`${profile.rangeKm} km`:'',(profile.preferredOperators||[]).join(', ')].filter(Boolean).join(' · ');main.append(title,meta);const acts=document.createElement('div');acts.className='personal-row-actions';acts.appendChild(personalButton(t('edit'),()=>personalEditVehicle(profile)));acts.appendChild(personalButton(t('remove'),()=>personalDeleteVehicle(profile),'ghost personal-danger'));row.append(main,acts);E.personalVehicleList.appendChild(row);});if(!rows.length)E.personalVehicleList.textContent=t('noVehicles');}
    function personalDataCategoryEntries(categories){if(Array.isArray(categories))return categories.map((row,index)=>[row&&String(row.category||row.id||row.name||index),row]).filter(([,row])=>row&&typeof row==='object');if(categories&&typeof categories==='object')return Object.entries(categories).map(([category,row])=>[category,typeof row==='number'?{volume:row}:row]).filter(([,row])=>row&&typeof row==='object');return[];}
    function personalDataCategoryName(category){const keys={observations:'categoryObservations',preferences:'categoryPreferences',explicit_preferences:'categoryPreferences',inferred_preferences:'categoryPreferences',favorites:'categoryFavorites',vehicle_profiles:'categoryVehicleProfiles',actions:'categoryActions',notifications:'categoryNotifications',sources:'categorySources',consents:'categoryConsents',device_profiles:'categoryDeviceProfiles'};return keys[category]?t(keys[category]):String(category||'').replace(/[_-]+/g,' ');}
    function personalDataVolume(row){const value=row.volume??row.count??row.records;return value!==undefined&&value!==null&&value!==''&&Number.isFinite(Number(value))?Number(value).toLocaleString():typeof value==='string'&&value.trim()?value:t('dataUnknown');}
    function personalDataSources(row){const value=row.sources??row.sourceIds??row.sourceCount;if(Array.isArray(value)){const labels=value.map(source=>typeof source==='string'?personalSourceName(source):source&&String(source.label||source.sourceId||source.id||'')).filter(Boolean);return labels.length?[...new Set(labels)].join(', '):t('dataUnknown');}if(value&&typeof value==='object'){const labels=Object.entries(value).filter(([,count])=>Number(count)>0).map(([source])=>personalSourceName(source));return labels.length?labels.join(', '):t('dataUnknown');}return value!==undefined&&value!==null&&value!==''&&Number.isFinite(Number(value))?Number(value).toLocaleString():typeof value==='string'&&value.trim()?value:t('dataUnknown');}
    function personalDataRetention(row){const value=row.retention??row.retentionDays;if(value!==undefined&&value!==null&&value!==''&&Number.isFinite(Number(value)))return`${Number(value).toLocaleString()} ${t('dataDays')}`;if(value&&typeof value==='object'){const days=value.days??value.retentionDays;if(days!==undefined&&days!==null&&days!==''&&Number.isFinite(Number(days)))return`${Number(days).toLocaleString()} ${t('dataDays')}`;const label=value.label||value.policy;return typeof label==='string'&&label.trim()?label:t('dataUnknown');}return typeof value==='string'&&value.trim()?value:t('dataUnknown');}
    function personalDataUpdated(row){const value=row.lastUpdatedAt??row.updatedAt;if(value===undefined||value===null||value==='')return t('dataUnknown');const timestamp=typeof value==='string'&&/^\d+$/.test(value)?Number(value):value,date=new Date(timestamp);return Number.isFinite(date.getTime())?date.toLocaleString():t('dataUnknown');}
    function renderPersonalDataCategories(categories){if(!E.personalDataCategories)return;const rows=personalDataCategoryEntries(categories);E.personalDataCategories.innerHTML='';E.personalDataCategories.classList.toggle('hidden',!rows.length);rows.forEach(([category,row])=>{const item=document.createElement('div');item.className='personal-data-category';item.setAttribute('role','listitem');const title=document.createElement('b');title.textContent=personalDataCategoryName(category);const metrics=document.createElement('div');metrics.className='personal-data-category-metrics';[[t('dataVolume'),personalDataVolume(row)],[t('dataSources'),personalDataSources(row)],[t('dataRetention'),personalDataRetention(row)],[t('dataLastUpdated'),personalDataUpdated(row)]].forEach(([label,value])=>{const metric=document.createElement('div');metric.className='personal-data-metric';const caption=document.createElement('span'),content=document.createElement('b');caption.textContent=label;content.textContent=value;metric.append(caption,content);metrics.appendChild(metric);});item.append(title,metrics);E.personalDataCategories.appendChild(item);});}
    function personalPreferenceDecisionLabel(decision){const key={confirmed:'preferenceDecisionConfirmed',corrected:'preferenceDecisionCorrected',rejected:'preferenceDecisionRejected'}[decision];return key?t(key):'';}
    function personalMemoryDate(value,fallback='memoryNeverUsed'){const date=new Date(Number(value));return Number.isFinite(date.getTime())?date.toLocaleString():t(fallback);}
    function personalMemoryFact(parent,label,value){const fact=document.createElement('div');fact.className='personal-memory-fact';const caption=document.createElement('span'),content=document.createElement('b');caption.textContent=label;content.textContent=value;fact.append(caption,content);parent.appendChild(fact);}
    function personalPreferenceSources(preference){const ids=[...new Set((preference.evidence||[]).map(evidence=>evidence&&evidence.sourceId).filter(Boolean))];if(ids.length)return ids.map(personalSourceName).join(', ');return preference.kind==='inferred'?personalText(['Inferência do Jarvis','Jarvis inference','Inferencia de Jarvis']):personalText(['Usuário','User','Usuario']);}
    function renderPersonalPreference(preference){
      const row=document.createElement('div');row.className='personal-row';const main=document.createElement('div');main.className='personal-row-main';const title=document.createElement('b');title.textContent=`${preference.key}: ${preference.value}`;
      const meta=document.createElement('span');meta.className='personal-meta';const decision=personalPreferenceDecisionLabel(preference.decision),decisionAt=preference.decisionAt&&Number.isFinite(new Date(preference.decisionAt).getTime())?`${t('preferenceDecisionAt')} ${new Date(preference.decisionAt).toLocaleString()}`:'';meta.textContent=[t(preference.kind==='inferred'?'preferenceInferred':'preferenceExplicit'),t(preference.polarity),decision,decisionAt].filter(Boolean).join(' · ');main.append(title,meta);
      const facts=document.createElement('div');facts.className='personal-memory-facts';const confidence=Math.max(0,Math.min(1,Number(preference.confidence)||0)),lastUsedAt=preference.lastUsedAt??preference.lastAppliedAt??(preference.usage&&preference.usage.lastUsedAt);
      personalMemoryFact(facts,t('memorySource'),personalPreferenceSources(preference));personalMemoryFact(facts,t('memoryEvidence'),String((preference.evidence||[]).length));personalMemoryFact(facts,t('memoryScope'),(preference.purposes||[]).map(personalPurposeName).join(', ')||t('dataUnknown'));personalMemoryFact(facts,t('memoryConfidence'),`${Math.round(confidence*100)}%`);personalMemoryFact(facts,t('memoryValidity'),preference.expiresAt?personalMemoryDate(preference.expiresAt):t('memoryNoExpiry'));personalMemoryFact(facts,t('memoryLastUsed'),personalMemoryDate(lastUsedAt));main.appendChild(facts);
      const evidence=document.createElement('details');evidence.className='personal-memory-evidence';const summary=document.createElement('summary');summary.textContent=`${t('memoryEvidence')} (${(preference.evidence||[]).length})`;evidence.appendChild(summary);const list=document.createElement('ul'),items=preference.evidence||[];if(items.length)items.forEach(item=>{const li=document.createElement('li');li.textContent=[item.summary,item.sourceId&&personalSourceName(item.sourceId),personalMemoryDate(item.at,'dataUnknown')].filter(Boolean).join(' · ');list.appendChild(li);});else{const li=document.createElement('li');li.textContent=t('memoryEvidenceUnknown');list.appendChild(li);}evidence.appendChild(list);main.appendChild(evidence);
      const actions=document.createElement('div');actions.className='personal-row-actions';if(preference.kind==='inferred'&&preference.decision!=='rejected'){actions.appendChild(personalButton(t('confirmPreference'),()=>personalDecidePreference(preference,'confirm')));actions.appendChild(personalButton(t('correctPreference'),()=>personalCorrectPreference(preference)));actions.appendChild(personalButton(t('rejectPreference'),()=>personalDecidePreference(preference,'reject'),'ghost personal-danger'));}else if(preference.kind!=='inferred')actions.appendChild(personalButton(t('edit'),()=>personalEditPreference(preference)));actions.appendChild(personalButton(t('forget'),()=>personalDeletePreference(preference),'ghost personal-danger'));row.append(main,actions);return row;
    }
    function renderPersonalData(){ if(!personalState)return; const d=personalState.dataSummary||{},observations=d.observations||0,explicit=d.explicitPreferences||0,inferred=d.inferredPreferences||0,actions=d.actions||0; if(E.personalDataSummary)E.personalDataSummary.textContent=personalText([`${observations} observações · ${explicit} preferências explícitas · ${inferred} inferidas · ${actions} ações`,`${observations} observations · ${explicit} explicit preferences · ${inferred} inferred · ${actions} actions`,`${observations} observaciones · ${explicit} preferencias explícitas · ${inferred} inferidas · ${actions} acciones`]);renderPersonalDataCategories(d.categories);
      E.personalFavoriteList.innerHTML=''; (personalState.favorites||[]).forEach(f=>{const row=document.createElement('div');row.className='personal-row';const main=document.createElement('div');main.className='personal-row-main';const b=document.createElement('b');b.textContent=f.label;const m=document.createElement('span');m.className='personal-meta';const aliases=(f.aliases||[]).join(', '),purposes=(f.purposes||[]).map(personalPurposeName).join(', '),geo=f.geofenceRadiusM?`${t('arrivalMonitoring')}: ${f.geofenceRadiusM} m · ${(f.geofenceTransitions||[]).map(x=>x==='enter'?t('arrival'):t('departure')).join(', ')}`:'',provenance=f.source&&f.source.sourceId?`${t('favoriteProvenance')}: ${f.source.attribution||personalSourceName(f.source.sourceId)}`:'';m.textContent=[f.address||`${f.point.lat.toFixed(4)}, ${f.point.lng.toFixed(4)}`,aliases&&`${t('favoriteAliases')}: ${aliases}`,purposes,provenance,geo].filter(Boolean).join(' · ');main.append(b,m);const acts=document.createElement('div');acts.className='personal-row-actions';acts.appendChild(personalButton(t('edit'),()=>personalEditFavorite(f)));acts.appendChild(personalButton(t('remove'),()=>personalDeleteFavorite(f.id),'ghost personal-danger'));row.append(main,acts);E.personalFavoriteList.appendChild(row);}); if(!personalState.favorites.length)E.personalFavoriteList.textContent=personalText(['Nenhum local salvo.','No saved places.','No hay lugares guardados.']);
      renderPersonalVehicles();E.personalPreferenceList.innerHTML='';(personalState.preferences||[]).forEach(preference=>E.personalPreferenceList.appendChild(renderPersonalPreference(preference)));if(!personalState.preferences.length)E.personalPreferenceList.textContent=personalText(['Nenhuma preferência salva.','No saved preferences.','No hay preferencias guardadas.']); }
    function renderPersonalState(){ if(!personalState)return; const s=personalState.settings;
      if(E.personalEnabled)E.personalEnabled.checked=!!s.enabled;if(E.personalPaused)E.personalPaused.checked=!!s.paused;if(E.personalLocationMode)E.personalLocationMode.value=s.locationMode;if(E.personalPrecision)E.personalPrecision.value=s.locationPrecision;if(E.personalQuietStart)E.personalQuietStart.value=s.notifications.quietStart;if(E.personalQuietEnd)E.personalQuietEnd.value=s.notifications.quietEnd;if(E.personalMaxPerDay)E.personalMaxPerDay.value=s.notifications.maxPerDay;if(E.personalCooldown)E.personalCooldown.value=s.notifications.cooldownMinutes;if(E.personalMinScore)E.personalMinScore.value=s.notifications.minScore;
      if(E.personalObservationsDays)E.personalObservationsDays.value=s.retention.observationsDays;if(E.personalDecisionsDays)E.personalDecisionsDays.value=s.retention.decisionsDays;if(E.personalInferencesDays)E.personalInferencesDays.value=s.retention.inferredPreferencesDays;if(E.personalKeepRawLocation)E.personalKeepRawLocation.checked=!!s.retention.keepRawLocation;
      if(E.personalLocationStatus)E.personalLocationStatus.textContent=personalActiveConsents('device-location').length?personalText(['Autorizada neste perfil.','Authorized for this profile.','Autorizada para este perfil.']):personalText(['Ainda não autorizada.','Not authorized yet.','Aún no autorizada.']);renderPersonalReferenceOptions();renderPersonalDeviceProfile();renderPersonalNativeStatus();renderPersonalSources();renderPersonalData();renderPersonalContextPolicyAlert(); }
    async function personalUpdateSettings(patch){ if(!personalState)await requestPersonalState(); if(!personalState)throw new Error(personalText(['Contexto pessoal indisponível.','Personal context unavailable.','Contexto personal no disponible.'])); return personalRequest({t:'personal_context_update',requestId:personalReqId(),revision:personalState.revision,patch}); }
    async function personalToggleSourcePause(sourceId){try{if(!personalState)await requestPersonalState();if(!personalState)return;const paused=new Set(personalState.settings.pausedSourceIds||[]);if(paused.has(sourceId))paused.delete(sourceId);else paused.add(sourceId);await personalUpdateSettings({pausedSourceIds:[...paused]});if(sourceId==='device-location'){if(paused.has(sourceId))await syncPersonalGeofences();else await initializePersonalNativeBridge();}toast(paused.has(sourceId)?personalText(['Fonte pausada.','Source paused.','Fuente pausada.']):personalText(['Fonte retomada.','Source resumed.','Fuente reanudada.']));}catch(e){personalError(e);}}
    async function personalGrantSource(sourceId,purposes,hydrate=true,requestedFields){try{if(!personalState)await requestPersonalState();const active=personalActiveConsents(sourceId),existing=active[0],defaultFields=sourceId==='device-location'?['position']:sourceId==='device-calendar'?['busy']:['*'],mergedPurposes=[...new Set([...active.flatMap(c=>c.purposes||[]),...(purposes||[])])],mergedFields=[...new Set([...active.flatMap(c=>c.fields||[]),...(requestedFields||defaultFields)])];if(!mergedPurposes.length)throw new Error(personalText(['A fonte não declara finalidades.','The source declares no purposes.','La fuente no declara finalidades.']));await personalRequest({t:'personal_consent_put',requestId:personalReqId(),revision:personalState.revision,consent:{id:existing?existing.id:`consent:${sourceId}:${personalReqId()}`,sourceId,purposes:mergedPurposes,fields:mergedFields,expiresAt:['device-location','device-calendar'].includes(sourceId)?Date.now()+30*86400000:undefined}});if(sourceId==='device-calendar'&&hydrate)await putPersonalCalendar(true);return true;}catch(e){personalError(e);return false;}}
    async function personalGrantCalDavDetails(row){const confirmed=await dialog({title:`${t('calendarDetailsConsentTitle')}\n\n${t('calendarDetailsConsentBody')}`,okText:t('authorizeDetails')});if(!confirmed)return false;const granted=await personalGrantSource(row.id,row.purposes&&row.purposes.length?row.purposes:['calendar'],false,['*','details']);if(granted)toast(t('calendarDetailsGranted'));return granted;}
    async function personalRevokeConsent(id){ try{const consent=(personalState.consents||[]).find(c=>c.id===id);await personalRequest({t:'personal_consent_revoke',requestId:personalReqId(),revision:personalState.revision,consentId:id});if(consent&&consent.sourceId==='device-location')await erasePersonalNativeContext();}catch(e){personalError(e);} }
    async function personalRevokeSource(sourceId){ try{for(const c of personalActiveConsents(sourceId))await personalRequest({t:'personal_consent_revoke',requestId:personalReqId(),revision:personalState.revision,consentId:c.id});if(sourceId==='device-location')await erasePersonalNativeContext();}catch(e){personalError(e);} }
    function personalNativePlugin(){try{return window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.JarvisContext;}catch(e){return null;}}
    function personalForegroundLocationPlugin(){try{return window.Capacitor&&typeof window.Capacitor.isNativePlatform==='function'&&window.Capacitor.isNativePlatform()&&window.Capacitor.Plugins&&window.Capacitor.Plugins.Geolocation;}catch(e){return null;}}
    function personalNativeScopeStorageKey(principalId,deviceId){return`jarvis_personal_native_scope:${principalId}:${deviceId}`;}
    function personalNativeScope(){const principalId=String(authUser&&authUser.id||'local'),profile=personalCurrentDeviceProfile(),marker=readPersonalDeviceMarker(),deviceId=String(profile&&profile.deviceId||marker&&marker.deviceId||'');if(!deviceId)return null;const key=personalNativeScopeStorageKey(principalId,deviceId);try{const stored=JSON.parse(localStorage.getItem(key)||'null');if(stored&&stored.principalId===principalId&&stored.deviceId===deviceId&&Number.isSafeInteger(stored.generation)&&stored.generation>=0)return stored;}catch(e){}const scope={principalId,deviceId,generation:1};try{localStorage.setItem(key,JSON.stringify(scope));}catch(e){}return scope;}
    function advancePersonalNativeScope(scope){if(!scope)return;const next={...scope,generation:Math.min(Number.MAX_SAFE_INTEGER,scope.generation+1)};try{localStorage.setItem(personalNativeScopeStorageKey(scope.principalId,scope.deviceId),JSON.stringify(next));}catch(e){}}
    async function erasePersonalNativeContext(){writePersonalTransitionQueue([]);personalNativeTransitionCount=0;personalNativeGeofenceConfigured=false;personalLocationReadyUntil=0;const plugin=personalNativePlugin(),scope=personalNativeScope();if(plugin&&scope&&typeof plugin.eraseAll==='function'){await plugin.eraseAll({scope});advancePersonalNativeScope(scope);}renderPersonalNativeStatus();renderPersonalReferenceOptions();}
    function personalTransitionQueueKey(){return'jarvis_personal_transitions:'+(authUser&&authUser.id||'local');}
    function readPersonalTransitionQueue(){try{const rows=JSON.parse(localStorage.getItem(personalTransitionQueueKey())||'[]');return Array.isArray(rows)?rows.slice(-200).map(sanitizePersonalTransition).filter(Boolean):[];}catch(e){return[];}}
    function writePersonalTransitionQueue(rows){try{const safe=(rows||[]).slice(-200).map(sanitizePersonalTransition).filter(Boolean);if(safe.length)localStorage.setItem(personalTransitionQueueKey(),JSON.stringify(safe));else localStorage.removeItem(personalTransitionQueueKey());}catch(e){}}
    function sanitizePersonalTransition(row){if(!row||typeof row!=='object')return null;const transition=row.transition==='enter'||row.transition==='exit'?row.transition:null,source=row.source==='android'||row.source==='ios'?row.source:null,occurredAt=Number(row.occurredAt),recordedAt=Number(row.recordedAt);if(!row.id||!row.geofenceId||!transition||!source||!Number.isFinite(occurredAt)||!Number.isFinite(recordedAt))return null;return{id:String(row.id).slice(0,200),geofenceId:String(row.geofenceId).slice(0,200),transition,occurredAt,recordedAt,source};}
    function personalConsentHasField(purpose,field){return personalActiveConsents('device-location').some(c=>(c.purposes||[]).includes(purpose)&&(c.fields||[]).includes(field));}
    function renderPersonalNativeStatus(){if(!E.personalNativeStatus)return;E.personalNativeStatus.innerHTML='';const add=(label,state)=>{const span=document.createElement('span');span.className='personal-capability '+state;span.textContent=label;E.personalNativeStatus.appendChild(span);};if(!personalNativeCapabilities||!personalNativeCapabilities.available){add(personalNativePlugin()?t('nativeContextUnavailable'):t('nativeContextWeb'),'limited');}else{if(personalNativeCapabilities.foregroundLocation)add(t('nativeForeground'),personalNativePermissions&&personalNativePermissions.location==='granted'?'ready':'limited');if(personalNativeCapabilities.busyIntervals)add(t('nativeCalendar'),personalNativePermissions&&personalNativePermissions.calendar==='granted'?'ready':'limited');if(personalNativeCapabilities.geofences)add(t('nativeGeofences'),personalNativePermissions&&personalNativePermissions.backgroundLocation==='granted'?'ready':'limited');if(personalNativeCapabilities.backgroundLocation)add(t('nativeBackground'),personalNativePermissions&&personalNativePermissions.backgroundLocation==='granted'?'ready':'limited');if(personalNativeTransitionCount)add(`${personalNativeTransitionCount} ${t('nativeTransitions')}`,'ready');}const monitored=personalState&&(personalState.favorites||[]).some(f=>f.geofenceRadiusM&&(f.geofenceTransitions||[]).length);if(E.personalGeofenceStatus){if(!monitored)E.personalGeofenceStatus.textContent=t('geofenceOptInNote');else if(!personalNativeCapabilities||!personalNativeCapabilities.geofences)E.personalGeofenceStatus.textContent=t('geofenceUnsupported');else E.personalGeofenceStatus.textContent=personalNativeGeofenceConfigured?t('geofenceActive'):t('geofenceSavedWaiting');}}
    async function drainPersonalNativeTransitions(){if(personalNativeDrainPromise)return personalNativeDrainPromise;personalNativeDrainPromise=(async()=>{const plugin=personalNativePlugin();if(!plugin||typeof plugin.leaseTransitions!=='function'||typeof plugin.ackTransitions!=='function'||!ws||ws.readyState!==1||!authed)return;if(!personalState)await requestPersonalState();const scope=personalNativeScope();if(!personalState||!personalState.settings.enabled||personalState.settings.paused||personalSourceIsPaused('device-location')||!scope)return;const lease=await plugin.leaseTransitions({scope,requestId:personalReqId(),limit:200,leaseDurationMs:60000}),accepted=[];for(const raw of lease&&lease.transitions||[]){const observation=sanitizePersonalTransition(raw);if(!observation)continue;const favorite=(personalState.favorites||[]).find(f=>f.id===observation.geofenceId&&f.geofenceRadiusM&&(f.geofenceTransitions||[]).includes(observation.transition));if(!favorite){accepted.push(observation.id);continue;}const purpose=(favorite.purposes||[]).find(p=>personalConsentHasField(p,'geofence'));if(!purpose)continue;try{await personalRequest({t:'personal_geofence_transition_put',requestId:personalReqId(),purpose,observation});accepted.push(observation.id);personalNativeTransitionCount++;}catch(e){}}if(lease&&lease.leaseId&&accepted.length)await plugin.ackTransitions({scope,leaseId:lease.leaseId,transitionIds:accepted});renderPersonalNativeStatus();})().catch(e=>{renderPersonalNativeStatus();}).finally(()=>{personalNativeDrainPromise=null;});return personalNativeDrainPromise;}
    async function clearUnavailablePersonalDeviceContext(permissions){if(!permissions||!personalState||!ws||ws.readyState!==1||!authed)return;if(permissions.location!=='granted'){personalLocationReadyUntil=0;await personalRequest({t:'personal_device_context_clear',requestId:personalReqId(),kind:'location'});}if(permissions.calendar!=='granted')await personalRequest({t:'personal_device_context_clear',requestId:personalReqId(),kind:'calendar'});}
    async function syncPersonalGeofences({requestBackground=false,grantConsent=false}={}){personalNativeGeofenceConfigured=false;const plugin=personalNativePlugin();if(!plugin||typeof plugin.configureGeofences!=='function'){renderPersonalNativeStatus();return;}personalNativeCapabilities=personalNativeCapabilities||await plugin.isSupported();if(!personalNativeCapabilities.geofences){renderPersonalNativeStatus();return;}if(!personalState)await requestPersonalState();if(!personalState){renderPersonalNativeStatus();return;}const scope=personalNativeScope();if(!scope){renderPersonalNativeStatus();return;}const active=personalState.settings.enabled&&!personalState.settings.paused&&!personalSourceIsPaused('device-location')&&personalState.settings.locationMode==='background',favorites=active?(personalState.favorites||[]).filter(f=>f.geofenceRadiusM&&(f.geofenceTransitions||[]).length):[],empty=()=>plugin.configureGeofences({geofences:[],scope,monitorSignificantChanges:false});if(!favorites.length){await empty();renderPersonalNativeStatus();return;}if(favorites.length>Number(personalNativeCapabilities.maxGeofences||20))throw new Error(personalText(['Há mais locais monitorados do que este aparelho suporta.','There are more monitored places than this device supports.','Hay más lugares monitorizados de los que admite este dispositivo.']));const purposes=[...new Set(favorites.flatMap(f=>f.purposes||['nearby']))];if(purposes.some(p=>!personalConsentHasField(p,'geofence'))){if(!requestBackground&&!grantConsent){await empty();renderPersonalNativeStatus();return;}const granted=await personalGrantSource('device-location',purposes,false,['geofence']);if(!granted||purposes.some(p=>!personalConsentHasField(p,'geofence')))throw new Error(personalText(['O consentimento de geofence não foi salvo.','Geofence consent was not saved.','No se guardó el consentimiento de geofence.']));}if(requestBackground){personalNativePermissions=await plugin.requestPermissions({location:true,backgroundLocation:true});}else personalNativePermissions=await plugin.checkPermissions();if(personalNativePermissions.backgroundLocation!=='granted'){await empty();renderPersonalNativeStatus();return;}await plugin.configureGeofences({geofences:favorites.map(f=>({id:f.id,point:{lat:f.point.lat,lng:f.point.lng,accuracyM:f.point.accuracyM},radiusM:f.geofenceRadiusM,transitions:f.geofenceTransitions})),scope,monitorSignificantChanges:false});personalNativeGeofenceConfigured=true;renderPersonalNativeStatus();}
    async function initializePersonalNativeBridge(){if(personalNativeInit)return personalNativeInit;personalNativeInit=(async()=>{const plugin=personalNativePlugin();if(!plugin||typeof plugin.isSupported!=='function'){renderPersonalNativeStatus();return;}personalNativeCapabilities=await plugin.isSupported();if(!personalState&&authed)await requestPersonalState();if(typeof plugin.checkPermissions==='function'){personalNativePermissions=await plugin.checkPermissions();await clearUnavailablePersonalDeviceContext(personalNativePermissions);}renderPersonalNativeStatus();if(!personalNativeCapabilities.available)return;if(!personalNativeTransitionListener&&typeof plugin.addListener==='function')personalNativeTransitionListener=await plugin.addListener('transitionAvailable',()=>{drainPersonalNativeTransitions();});await drainPersonalNativeTransitions();if(personalState&&personalState.settings.locationMode==='background')await syncPersonalGeofences();})().catch(e=>{renderPersonalNativeStatus();}).finally(()=>{personalNativeInit=null;});return personalNativeInit;}
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&authed)initializePersonalNativeBridge();});
    async function capturePersonalLocation({requestBackground=false}={}){if(personalState&&(!personalState.settings.enabled||personalState.settings.paused||personalSourceIsPaused('device-location')))throw new Error(personalText(['A fonte de localização está pausada.','The location source is paused.','La fuente de ubicación está pausada.'])); const precise=personalState&&personalState.settings.locationPrecision==='precise', native=personalNativePlugin(),geolocation=personalForegroundLocationPlugin();if(native&&typeof native.isSupported==='function'&&!personalNativeCapabilities)personalNativeCapabilities=await native.isSupported();if(geolocation&&typeof geolocation.getCurrentPosition==='function'){let permission=typeof geolocation.checkPermissions==='function'?await geolocation.checkPermissions():null;if(permission&&permission.location!=='granted'&&typeof geolocation.requestPermissions==='function')permission=await geolocation.requestPermissions({permissions:['location']});if(permission&&permission.location!=='granted')throw new Error(personalText(['Permissão de localização negada. Abra as configurações do app para autorizar.','Location permission denied. Open app settings to allow it.','Permiso de ubicación denegado. Abre los ajustes de la app para autorizarlo.']));const position=await geolocation.getCurrentPosition({enableHighAccuracy:!!precise,maximumAge:300000,timeout:12000}),observedAt=Number.isFinite(Number(position.timestamp))?Number(position.timestamp):Date.now(),platform=window.Capacitor&&typeof window.Capacitor.getPlatform==='function'?window.Capacitor.getPlatform():'android';if(native&&typeof native.checkPermissions==='function')personalNativePermissions=await native.checkPermissions();renderPersonalNativeStatus();return{observedAt,expiresAt:observedAt+900000,point:{lat:position.coords.latitude,lng:position.coords.longitude,accuracyM:position.coords.accuracy},precision:precise?'precise':'approximate',source:platform==='ios'?'ios':'android'};}
      if(!navigator.geolocation)throw new Error(personalText(['Localização não suportada neste aparelho.','Location is unsupported on this device.','La ubicación no es compatible con este dispositivo.'])); return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>resolve({observedAt:Date.now(),expiresAt:Date.now()+900000,point:{lat:p.coords.latitude,lng:p.coords.longitude,accuracyM:p.coords.accuracy},precision:precise?'precise':'approximate',source:'web'}),e=>reject(new Error(e.message||personalText(['Permissão de localização negada.','Location permission denied.','Permiso de ubicación denegado.']))),{enableHighAccuracy:precise,maximumAge:300000,timeout:12000})); }
    async function putPersonalLocation(purpose,grantAll=false,requestBackground=false){ if(!personalState)await requestPersonalState(); if(!personalState||!personalState.settings.enabled)throw new Error(personalText(['Ative e salve o assistente primeiro.','Enable and save the assistant first.','Activa y guarda el asistente primero.'])); if(personalState.settings.locationMode==='off')throw new Error(personalText(['Escolha um modo de localização primeiro.','Choose a location mode first.','Elige primero un modo de ubicación.'])); const purposes=grantAll?personalSourcePurposes('device_location'):[purpose]; if(!personalActiveConsents('device-location').some(c=>purposes.every(p=>(c.purposes||[]).includes(p))&&(c.fields||[]).includes('position')))await personalGrantSource('device-location',purposes,true,['position']); if(!personalConsentHasField(purpose,'position'))throw new Error(personalText(['Consentimento de localização não foi salvo.','Location consent was not saved.','No se guardó el consentimiento de ubicación.'])); const observation=await capturePersonalLocation({requestBackground}); await personalRequest({t:'personal_location_put',requestId:personalReqId(),observation,purpose});personalLocationReadyUntil=Number(observation.expiresAt)||Date.now()+900000;renderPersonalReferenceOptions(); if(E.personalLocationStatus)E.personalLocationStatus.textContent=personalText(['Localização atualizada por 15 minutos.','Location updated for 15 minutes.','Ubicación actualizada por 15 minutos.']); return observation; }
    async function putPersonalCalendar(skipGrant=false){if(!personalState)await requestPersonalState();if(!personalState||!personalState.settings.enabled)throw new Error(personalText(['Ative e salve o assistente primeiro.','Enable and save the assistant first.','Activa y guarda el asistente primero.']));if(personalState.settings.paused||personalSourceIsPaused('device-calendar'))throw new Error(personalText(['A fonte de agenda do aparelho está pausada.','The device calendar source is paused.','La fuente de calendario del dispositivo está pausada.']));if(!personalActiveConsents('device-calendar').some(c=>c.purposes.includes('calendar'))){if(skipGrant)throw new Error(personalText(['Consentimento da agenda não foi salvo.','Calendar consent was not saved.','No se guardó el consentimiento de agenda.']));await personalGrantSource('device-calendar',['calendar'],false);}const plugin=personalNativePlugin();if(plugin&&typeof plugin.isSupported==='function'&&!personalNativeCapabilities)personalNativeCapabilities=await plugin.isSupported();if(!plugin||!personalNativeCapabilities||!personalNativeCapabilities.available||!personalNativeCapabilities.busyIntervals||typeof plugin.getBusyIntervals!=='function')throw new Error(personalText(['A agenda do aparelho só está disponível no app nativo; configure CalDAV para Web/Electron.','Device calendar is available only in the native app; configure CalDAV for Web/Electron.','La agenda del dispositivo solo está disponible en la app nativa; configura CalDAV para Web/Electron.']));if(typeof plugin.requestPermissions==='function')personalNativePermissions=await plugin.requestPermissions({calendar:true});renderPersonalNativeStatus();const startAt=Date.now(),endAt=startAt+7*86400000,observation=await plugin.getBusyIntervals({startAt,endAt,maxIntervals:512,ttlMs:900000});await personalRequest({t:'personal_calendar_put',requestId:personalReqId(),observation});return observation;}
    function personalFocusable(modal){return[...modal.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),details summary,[tabindex]:not([tabindex="-1"])')].filter(el=>!el.closest('.hidden')&&el.getClientRects().length);}
    function trapPersonalModalKey(event,modal,close){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}if(event.key!=='Tab')return;const rows=personalFocusable(modal);if(!rows.length){event.preventDefault();return;}const first=rows[0],last=rows[rows.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
    function restorePersonalFocus(target){if(target&&target.isConnected&&typeof target.focus==='function')setTimeout(()=>target.focus(),0);}
    function personalDateTimeLocal(timestamp){const date=new Date(Number(timestamp));if(!Number.isFinite(date.getTime()))return'';return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
    function openPersonalCalendarEdit(suggestion,source){const built=personalCalendarPayload(suggestion,suggestion&&suggestion.candidate&&suggestion.candidate.data&&suggestion.candidate.data.calendarHref,{existing:true});if(!built){personalError(new Error(t('calendarActionUnavailable')));return;}if(E.personalCalendarEditModal.classList.contains('hidden'))personalCalendarEditReturnFocus=document.activeElement;personalCalendarEditContext={suggestion,sourceId:source.id};E.personalCalendarEditTitle.value=built.payload.title;E.personalCalendarEditStart.value=personalDateTimeLocal(built.payload.startAt);E.personalCalendarEditEnd.value=personalDateTimeLocal(built.payload.endAt);E.personalCalendarEditLocation.value=built.payload.location||'';E.personalCalendarEditDescription.value=built.payload.description||'';E.personalCalendarEditModal.classList.remove('hidden');setTimeout(()=>E.personalCalendarEditTitle.focus(),20);}
    function closePersonalCalendarEdit(restore=true){E.personalCalendarEditModal.classList.add('hidden');personalCalendarEditContext=null;const target=personalCalendarEditReturnFocus;personalCalendarEditReturnFocus=null;if(restore)restorePersonalFocus(target);return target;}
    async function previewPersonalCalendarEdit(){if(!personalCalendarEditContext)return;const {suggestion,sourceId}=personalCalendarEditContext,title=E.personalCalendarEditTitle.value.trim(),startAt=new Date(E.personalCalendarEditStart.value).getTime(),endAt=new Date(E.personalCalendarEditEnd.value).getTime(),data=suggestion.candidate&&suggestion.candidate.data||{},source=personalCalDavSources('external_reversible:calendar.update').find(row=>row.id===sourceId&&personalCalendarResourceMatches(row,data.calendarHref));if(!source){personalError(new Error(t('calendarActionUnavailable')));return;}if(!title||!Number.isFinite(startAt)||!Number.isFinite(endAt)||endAt<=startAt){personalError(new Error(personalText(['Informe título, início e fim válidos; o fim deve ser posterior ao início.','Provide a valid title, start and end; end must be after start.','Indica título, inicio y fin válidos; el fin debe ser posterior al inicio.'])));return;}const built=personalCalendarPayload(suggestion,data.calendarHref,{existing:true,title,startAt,endAt,location:E.personalCalendarEditLocation.value,description:E.personalCalendarEditDescription.value});if(!built){personalError(new Error(t('calendarActionUnavailable')));return;}E.personalCalendarEditPreview.disabled=true;try{const action=await requestPersonalCalendarPreview(source,'update',built.payload),returnFocus=closePersonalCalendarEdit(false);openPersonalAction(action,'',returnFocus);}catch(e){personalError(e);}finally{E.personalCalendarEditPreview.disabled=false;}}
    function openPersonalModal(){if(E.personalModal.classList.contains('hidden'))personalModalReturnFocus=document.activeElement;E.personalModal.classList.remove('hidden');closeSide();if(!personalState)requestPersonalState();setTimeout(()=>E.personalQuery.focus(),30);}
    function closePersonalModal(){E.personalModal.classList.add('hidden');if(personalDeepLinkTarget(location.href))history.replaceState(null,'',location.pathname+location.search);restorePersonalFocus(personalModalReturnFocus);}
    E.personalModal.addEventListener('keydown',e=>trapPersonalModalKey(e,E.personalModal,closePersonalModal));
    E.personalCalendarEditModal.addEventListener('keydown',e=>trapPersonalModalKey(e,E.personalCalendarEditModal,closePersonalCalendarEdit));
    E.personalActionModal.addEventListener('keydown',e=>trapPersonalModalKey(e,E.personalActionModal,closePersonalAction));
    E.personalModal.addEventListener('click',e=>{if(e.target===E.personalModal)closePersonalModal();});
    E.personalCalendarEditModal.addEventListener('click',e=>{if(e.target===E.personalCalendarEditModal)closePersonalCalendarEdit();});
    function setPersonalView(view){const map=view==='map';E.personalResults.classList.toggle('hidden',map);E.personalMap.classList.toggle('hidden',!map);E.personalViewList.classList.toggle('on',!map);E.personalViewMap.classList.toggle('on',map);if(map)renderPersonalMap();}
    function appendPersonalSources(parent,s){const refs=s.sources||[],freshness={live:['ao vivo','live','en vivo'],fresh:['recente','fresh','reciente'],stale:['desatualizada','stale','desactualizada'],unknown:['atualização desconhecida','unknown freshness','actualización desconocida']};if(!refs.length){parent.textContent=personalText(['Fonte não informada','Source not provided','Fuente no informada']);return;}refs.forEach((ref,index)=>{if(index)parent.append(' · ');const label=ref.attribution||personalSourceName(ref.sourceId),safeUrl=typeof ref.url==='string'&&/^https:\/\//i.test(ref.url);if(safeUrl){const a=document.createElement('a');a.href=ref.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label;parent.appendChild(a);}else parent.append(label);if(ref.freshness)parent.append(` (${personalText(freshness[ref.freshness]||[ref.freshness,ref.freshness,ref.freshness])})`);const observedAt=Number(ref.observedAt);if(Number.isFinite(observedAt)&&observedAt>0)parent.append(` · ${personalText(['observado','observed','observado'])} ${new Date(observedAt).toLocaleString()}`);});}
    function personalCandidateSummary(s){const candidate=s.candidate||{},d=candidate.data||{},parts=[],routed=Number(d.routedDistanceM),straight=Number(d.straightLineDistanceM),confidence=Number(d.confidence??d.matchConfidence??d.importance),category=d.category||d.type||d.class,km=value=>(value/1000).toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1});if(category)parts.push(String(category));if(candidate.point&&Number.isFinite(Number(candidate.point.lat))&&Number.isFinite(Number(candidate.point.lng)))parts.push(`${Number(candidate.point.lat).toFixed(5)}, ${Number(candidate.point.lng).toFixed(5)}`);if(Number.isFinite(routed))parts.push(`${personalText(['rota','route','ruta'])} ${routed<1000?`${Math.round(routed)} m`:`${km(routed)} km`}`);else if(Number.isFinite(straight))parts.push(`${personalText(['linha reta','straight line','línea recta'])} ${straight<1000?`${Math.round(straight)} m`:`${km(straight)} km`}`);if(Number.isFinite(Number(d.durationSeconds)))parts.push(`${Math.round(Number(d.durationSeconds)/60)} min`);if(d.startAt)parts.push(new Date(Number(d.startAt)).toLocaleString());if(d.locationName)parts.push(String(d.locationName));if(d.state)parts.push(String(d.state));if(d.updatedAt)parts.push(`${personalText(['atualizado','updated','actualizado'])} ${new Date(Number(d.updatedAt)).toLocaleString()}`);if(d.openingHours)parts.push(String(d.openingHours));if(d.operationalStatus&&d.operationalStatus.title)parts.push(String(d.operationalStatus.title));if(d.availability&&d.availability.status)parts.push(String(d.availability.status));if(d.current&&Number.isFinite(Number(d.current.temperature_2m)))parts.push(`${d.current.temperature_2m}°`);if(Number.isFinite(confidence))parts.push(`${personalText(['confiança','confidence','confianza'])} ${Math.round(Math.max(0,Math.min(1,confidence))*100)}%`);return parts.slice(0,10).join(' · ');}
    function appendPersonalConflicts(parent,suggestion){const data=suggestion&&suggestion.candidate&&suggestion.candidate.data||{},conflicts=Array.isArray(data.conflicts)?data.conflicts.slice(0,20):[];if(!conflicts.length)return;const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('div');details.className='personal-result-conflicts';summary.textContent=personalText([`Conflitos entre fontes (${conflicts.length})`,`Source conflicts (${conflicts.length})`,`Conflictos entre fuentes (${conflicts.length})`]);conflicts.forEach(conflict=>{const row=document.createElement('div'),values=Array.isArray(conflict&&conflict.values)?conflict.values.slice(0,10):[];row.textContent=[String(conflict&&conflict.field||''),...values.map(value=>{const observedAt=Number(value&&value.observedAt),when=Number.isFinite(observedAt)?new Date(observedAt).toLocaleString():'',rawValue=value&&value.value!==undefined?value.value:'';return`${personalSourceName(String(value&&value.sourceId||''))}: ${String(rawValue)} ${when}`.trim();})].filter(Boolean).join(' · ');body.appendChild(row);});if(data.preferredSourceId){const preferred=document.createElement('b');preferred.textContent=personalText([`Valor mais recente: ${personalSourceName(data.preferredSourceId)}`,`Most recent value: ${personalSourceName(data.preferredSourceId)}`,`Valor más reciente: ${personalSourceName(data.preferredSourceId)}`]);body.prepend(preferred);}details.append(summary,body);parent.appendChild(details);}
    function personalCalDavSources(grant){return(personalState&&personalState.sources||[]).filter(source=>source.type==='caldav'&&source.enabled&&(source.allowedActions||[]).includes(grant)&&(source.allowedResources||[]).length);}
    function personalCalendarResourceMatches(source,href){if(typeof href!=='string'||!href)return false;return(source.allowedResources||[]).some(resource=>{if(resource===href)return true;if(!source.endpoint)return false;try{return new URL(resource,source.endpoint).toString()===new URL(href,source.endpoint).toString();}catch(e){return false;}});}
    function personalCalendarExistingSource(suggestion,grant){const data=suggestion&&suggestion.candidate&&suggestion.candidate.data||{},sourceIds=new Set((suggestion&&suggestion.sources||[]).map(ref=>ref.sourceId));return personalCalDavSources(grant).find(source=>sourceIds.has(source.id)&&personalCalendarResourceMatches(source,data.calendarHref));}
    function personalStableHash(value){let first=0x811c9dc5,second=0x9e3779b9;for(let index=0;index<value.length;index++){const code=value.charCodeAt(index);first=Math.imul(first^code,0x01000193);second=Math.imul(second^code,0x5bd1e995);second^=second>>>13;}return(first>>>0).toString(16).padStart(8,'0')+(second>>>0).toString(16).padStart(8,'0');}
    function personalCalendarResourceLabel(source,calendarHref){let calendar=calendarHref;try{const url=new URL(calendarHref,source.endpoint),parts=url.pathname.split('/').filter(Boolean);calendar=decodeURIComponent(parts[parts.length-1]||url.hostname);}catch(e){}return[source.label||source.id,calendar].filter(Boolean).join(' · ');}
    function personalCalendarEventInfo(suggestion,{existing=false}={}){const candidate=suggestion&&suggestion.candidate||{},data=candidate.data||{},kind=String(candidate.kind||suggestion&&suggestion.kind||'');if(!['event','calendar_event'].includes(kind))return null;const startAt=Number(data.startAt),givenEnd=Number(data.endAt),endInferred=!Number.isFinite(givenEnd)||givenEnd<=startAt,endAt=endInferred?startAt+3600000:givenEnd,title=String(candidate.title||'').trim().slice(0,512);if(!title||!Number.isFinite(startAt)||!Number.isFinite(endAt)||endAt<=startAt)return null;const identity=[candidate.id||suggestion.id,title,startAt,(suggestion.sources||[]).map(ref=>ref.sourceId).sort().join(',')].join('|'),uid=existing?String(data.uid||'').trim():`jarvis-${personalStableHash(identity)}@jarvis.local`;if(!uid)return null;return{candidate,data,title,startAt,endAt,endInferred,uid};}
    function personalCalendarPayload(suggestion,calendarHref,{existing=false,title,startAt,endAt,location,description}={}){const info=personalCalendarEventInfo(suggestion,{existing});if(!info)return null;const payload={calendarHref,title:String(title??info.title).trim().slice(0,512),startAt:Number(startAt??info.startAt),endAt:Number(endAt??info.endAt),timeZone:personalDeviceTimeZone(),remindersMinutes:[]},place=location??info.data.location??info.data.locationName,details=description??info.data.description;if(!payload.title||!Number.isFinite(payload.startAt)||!Number.isFinite(payload.endAt)||payload.endAt<=payload.startAt)return null;if(place!==undefined&&String(place).trim())payload.location=String(place).trim().slice(0,1024);if(details!==undefined&&String(details).trim())payload.description=String(details).trim().slice(0,16384);if(existing){payload.uid=info.uid;payload.eventHref=String(info.data.eventHref||'');payload.expectedEtag=String(info.data.etag||'');if(!payload.eventHref||!payload.expectedEtag)return null;}return{payload,info};}
    async function requestPersonalCalendarPreview(source,operation,payload){const kind=`calendar.caldav:${source.id}:${operation}`,idempotencyKey=`calendar:${operation}:${personalStableHash(kind+'|'+JSON.stringify(payload))}`,result=await personalRequest({t:'personal_action_preview',requestId:personalReqId(),kind,idempotencyKey,payload});return result.action;}
    async function previewPersonalCalendarOperation(source,operation,payload,note=''){try{openPersonalAction(await requestPersonalCalendarPreview(source,operation,payload),note);}catch(e){personalError(e);}}
    function personalCalendarCreateTargets(){return personalCalDavSources('external_reversible:calendar.create').flatMap(source=>(source.allowedResources||[]).map(calendarHref=>({source,calendarHref})));}
    function appendPersonalCalendarActions(parent,suggestion){const event=personalCalendarEventInfo(suggestion);if(!event)return;const targets=personalCalendarCreateTargets();if(targets.length){let select=null;if(targets.length>1){select=document.createElement('select');select.className='personal-calendar-target';select.setAttribute('aria-label',t('calendarDestination'));select.title=t('calendarDestination');targets.forEach((target,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=personalCalendarResourceLabel(target.source,target.calendarHref);select.appendChild(option);});parent.appendChild(select);}const add=personalButton(t('addToCalendar'),()=>{const target=targets[Number(select&&select.value||0)]||targets[0],built=personalCalendarPayload(suggestion,target.calendarHref);if(!built){personalError(new Error(t('calendarActionUnavailable')));return;}previewPersonalCalendarOperation(target.source,'create',built.payload,built.info.endInferred?t('calendarEndFallback'):'');});parent.appendChild(add);}const updateSource=personalCalendarExistingSource(suggestion,'external_reversible:calendar.update'),deleteSource=personalCalendarExistingSource(suggestion,'consequential:calendar.delete');if(updateSource&&personalCalendarPayload(suggestion,event.data.calendarHref,{existing:true}))parent.appendChild(personalButton(t('editCalendarEvent'),()=>openPersonalCalendarEdit(suggestion,updateSource)));if(deleteSource){const built=personalCalendarPayload(suggestion,event.data.calendarHref,{existing:true});if(built)parent.appendChild(personalButton(t('deleteCalendarEvent'),()=>previewPersonalCalendarOperation(deleteSource,'delete',built.payload,built.info.endInferred?t('calendarEndFallback'):''),'ghost personal-danger'));}}
    async function personalFeedback(suggestion,kind,purpose){try{if(!personalState)await requestPersonalState();const data=suggestion.candidate&&suggestion.candidate.data||{},key=String(data.category||suggestion.kind||'suggestion').slice(0,100),value=String(suggestion.candidate.title||'').slice(0,500),sourceId=suggestion.sources&&suggestion.sources[0]&&suggestion.sources[0].sourceId;await personalRequest({t:'personal_feedback_put',requestId:personalReqId(),revision:personalState.revision,feedback:{id:`feedback:${personalReqId()}`,suggestionId:suggestion.id,purpose:purpose||E.personalPurpose.value,kind,key,value,sourceId}});toast(t({like:'feedbackLiked',dislike:'feedbackDisliked',avoid:'feedbackAvoided',remember:'feedbackRemembered'}[kind]||'feedbackRemembered'));}catch(e){personalError(e);}}
    function createPersonalSuggestionElement(s,purpose){const el=document.createElement('div');el.className='personal-result';const candidate=s&&s.candidate||{},top=document.createElement('div');top.className='personal-result-top';const b=document.createElement('b');b.textContent=candidate.title||s.kind||t('personalAssistant');const score=document.createElement('span');score.className='personal-score';score.textContent=Math.round((s.score||0)*100)+'%';top.append(b,score);el.appendChild(top);const facts=personalCandidateSummary(s);if(facts){const f=document.createElement('div');f.className='personal-meta';f.textContent=facts;el.appendChild(f);}if(s.reasons&&s.reasons.length){const d=document.createElement('div');d.className='personal-reasons';d.textContent=s.reasons.join(' · ');el.appendChild(d);}const src=document.createElement('div');src.className='personal-sources';appendPersonalSources(src,s);el.appendChild(src);appendPersonalConflicts(el,s);if(s.caveats&&s.caveats.length){const c=document.createElement('div');c.className='personal-sources';c.textContent='⚠ '+s.caveats.join(' · ');el.appendChild(c);}const acts=document.createElement('div');acts.className='personal-inline-actions';if(candidate.point){acts.appendChild(personalButton(personalText(['Abrir rota','Open directions','Abrir ruta']),()=>previewPersonalNavigation(s)));acts.appendChild(personalButton(t('saveAsFavorite'),()=>personalSaveSuggestionAsFavorite(s,purpose||E.personalPurpose.value)));}appendPersonalCalendarActions(acts,s);(s.actions||[]).forEach(a=>acts.appendChild(personalButton(String(a.preview&&a.preview.label||a.kind),()=>openPersonalAction(a))));acts.appendChild(personalButton(t('like'),()=>personalFeedback(s,'like',purpose)));acts.appendChild(personalButton(t('dislike'),()=>personalFeedback(s,'dislike',purpose)));acts.appendChild(personalButton(t('avoidSuggestion'),()=>personalFeedback(s,'avoid',purpose)));acts.appendChild(personalButton(t('remember'),()=>personalFeedback(s,'remember',purpose)));el.appendChild(acts);return el;}
    function renderPersonalDiagnostics(rows){if(!E.personalDiagnostics||!E.personalDiagnosticsBody)return;const diagnostics=(Array.isArray(rows)?rows:[]).filter(row=>row&&row.status==='discarded'&&typeof row.candidateId==='string'&&Array.isArray(row.reasons)).slice(0,100);E.personalDiagnostics.classList.toggle('hidden',!diagnostics.length);E.personalDiagnostics.open=false;E.personalDiagnosticsCount.textContent=diagnostics.length?`(${diagnostics.length} ${t('rankingDiagnosticsCount')})`:'';E.personalDiagnosticsBody.innerHTML='';diagnostics.forEach(row=>{const item=document.createElement('div');item.className='personal-diagnostic';item.setAttribute('role','listitem');const title=document.createElement('b'),reasons=document.createElement('span');title.textContent=[row.kind,row.candidateId,t('diagnosticDiscarded')].filter(Boolean).join(' · ');reasons.textContent=row.reasons.slice(0,20).map(String).join(' · ');item.append(title,reasons);E.personalDiagnosticsBody.appendChild(item);});}
    async function personalEnableRegionSource(suggestion,button){if(!suggestion||!personalState)return;if(button){button.disabled=true;button.textContent=t('regionSourceEnabling');}try{const source={id:suggestion.sourceId,type:suggestion.type,label:suggestion.label,enabled:true,endpoint:suggestion.endpoint,config:{attribution:suggestion.attribution,timeZone:suggestion.timeZone},allowedResources:[],allowedActions:[]};await personalRequest({t:'personal_source_put',requestId:personalReqId(),revision:personalState.revision,source});await requestPersonalState();toast(personalText(['Fonte regional ativada.','Regional source enabled.','Fuente regional activada.']));if(button){button.textContent=t('regionSourceEnabled');}}catch(e){personalError(e);if(button){button.disabled=false;button.textContent=t('regionSourceEnable');}}}
    function renderPersonalRegionSuggestion(suggestion){if(!suggestion)return null;const box=document.createElement('div');box.className='personal-note personal-region-suggestion';const place=[suggestion.city,suggestion.countryCode?suggestion.countryCode.toUpperCase():''].filter(Boolean).join(', ');const text=document.createElement('span');text.textContent=`${personalText(['Fonte de eventos aberta encontrada','Open events source found','Fuente de eventos abierta encontrada'])}: ${suggestion.label}${place?' ('+place+')':''}.`;box.appendChild(text);if(authUser&&authUser.role==='owner'){const btn=personalButton(t('regionSourceEnable'),()=>personalEnableRegionSource(suggestion,btn));box.appendChild(btn);}return box;}
    function renderPersonalSuggestions(rows,errors=[],purpose,diagnostics=[],regionSuggestion){personalSuggestions=rows||[];E.personalResults.innerHTML='';if(purpose&&E.personalPurpose){E.personalPurpose.value=purpose;renderPersonalReferenceOptions();}const regionBox=renderPersonalRegionSuggestion(regionSuggestion);if(regionBox)E.personalResults.appendChild(regionBox);if(!personalSuggestions.length){const empty=document.createElement('div');empty.textContent=errors.length?errors.map(e=>e.error).join(' · '):personalText(['Nenhum resultado encontrado nas fontes autorizadas.','No results from authorized sources.','No hay resultados en las fuentes autorizadas.']);E.personalResults.appendChild(empty);}personalSuggestions.forEach(s=>E.personalResults.appendChild(createPersonalSuggestionElement(s,purpose||E.personalPurpose.value)));renderPersonalDiagnostics(diagnostics);if(!E.personalMap.classList.contains('hidden'))renderPersonalMap();}
    function personalSuggestionById(id){if(!id)return null;const direct=personalSuggestions.find(s=>s.id===id);if(direct)return direct;for(const row of personalTurnSuggestions.values()){const found=(row.response&&row.response.suggestions||[]).find(s=>s.id===id);if(found)return found;}return null;}
    function openPersonalSuggestionResponse(response,purpose){openPersonalModal();renderPersonalSuggestions(response&&response.suggestions||[],response&&response.errors||[],purpose,response&&response.diagnostics||[]);E.personalQueryStatus.textContent=personalText(['Sugestões geradas para esta conversa.','Suggestions generated for this conversation.','Sugerencias generadas para esta conversación.']);setPersonalView('list');}
    function renderPersonalTurnSuggestionForCurrent(rebuild=false){if(!currentSession||!E.log)return;const key=sessionStateKey(currentSession,currentSessionRunner),frame=personalTurnSuggestions.get(key),existing=[...E.log.querySelectorAll('.personal-chat-card')].find(el=>el.dataset.personalKey===key);if(existing&&rebuild)existing.remove();else if(existing)return;if(!frame)return;const card=document.createElement('div');card.className='msg bot personal-chat-card';card.dataset.personalKey=key;const head=document.createElement('div');head.className='personal-chat-head';const copy=document.createElement('div'),title=document.createElement('div'),meta=document.createElement('div');title.className='personal-chat-title';title.textContent=t('personalTurnTitle');meta.className='personal-note';const rows=frame.response&&frame.response.suggestions||[];meta.textContent=`${personalPurposeName(frame.purpose)} · ${rows.length}`;copy.append(title,meta);const open=personalButton(t('openSuggestions'),()=>openPersonalSuggestionResponse(frame.response,frame.purpose));head.append(copy,open);card.appendChild(head);const body=document.createElement('div');body.className='personal-chat-results';rows.slice(0,3).forEach(s=>body.appendChild(createPersonalSuggestionElement(s,frame.purpose)));if(!rows.length){const empty=document.createElement('div');empty.className='personal-note';empty.textContent=personalText(['Nenhuma sugestão disponível agora.','No suggestions available now.','No hay sugerencias disponibles ahora.']);body.appendChild(empty);}card.appendChild(body);const anchor=pendingEl||null;if(anchor)E.log.insertBefore(card,anchor);else E.log.appendChild(card);frame.seen=true;personalTurnSuggestions.set(key,frame);renderRecents();autoScroll();}
    function handlePersonalTurnSuggestions(frame){const key=sessionStateKey(frame.sessionId,frame.runnerId||'local');personalTurnSuggestions.delete(key);personalTurnSuggestions.set(key,{...frame,seen:false});while(personalTurnSuggestions.size>100)personalTurnSuggestions.delete(personalTurnSuggestions.keys().next().value);if(frame.sessionId===currentSession&&(frame.runnerId||'local')===currentSessionRunner)renderPersonalTurnSuggestionForCurrent(true);else{unread.add(key);renderRecents();const session=sessions.find(s=>s.id===frame.sessionId&&(s.runnerId||selectedRunner())===(frame.runnerId||'local'));toast(`${t('personalSuggestionsAvailable')}${session&&session.title?' · '+session.title:''}`,{onClick:()=>openSession(frame.sessionId,frame.runnerId||'local'),ariaLabel:t('openSuggestions')});}if(!personalState)requestPersonalState().then(()=>{if(frame.sessionId===currentSession&&(frame.runnerId||'local')===currentSessionRunner)renderPersonalTurnSuggestionForCurrent(true);});}
    async function previewPersonalNavigation(suggestion){try{const point=suggestion.candidate.point,label=encodeURIComponent(suggestion.candidate.title);const result=await personalRequest({t:'personal_action_preview',requestId:personalReqId(),kind:'navigation.open',idempotencyKey:`suggestion:${suggestion.id}:navigation`,payload:{title:suggestion.candidate.title,url:`geo:${point.lat},${point.lng}?q=${point.lat},${point.lng}%28${label}%29`}});openPersonalAction(result.action);}catch(e){personalError(e);}}
    async function runPersonalQuery(){
      if(E.personalRun.disabled)return;E.personalRun.disabled=true;
      try{
        if(!personalState)await requestPersonalState();const purpose=E.personalPurpose.value,reference=E.personalReference&&E.personalReference.value||'auto',filters={};let point;
        if(reference.startsWith('favorite:'))filters.favoriteId=reference.slice('favorite:'.length);
        else if(reference==='region'){
          const regionText=E.personalRegion.value.trim();if(!personalResolvedRegion||personalResolvedRegion.queryText!==regionText)await resolvePersonalRegion();
          if(!personalResolvedRegion||!personalResolvedRegion.point){E.personalQueryStatus.textContent=t('chooseRegion');return;}
          point=personalResolvedRegion.point;filters.region=regionText;
        }
        E.personalQueryStatus.textContent=personalText(['Consultando fontes autorizadas...','Querying authorized sources...','Consultando fuentes autorizadas...']);if(purpose==='calendar'&&personalActiveConsents('device-calendar').length)await putPersonalCalendar(true);
        const query={purpose,text:E.personalQuery.value.trim(),locale:lang,limit:20,...(point?{point}:{}),...(Object.keys(filters).length?{filters}:{})},result=await personalContextQuery(query);
        E.personalQueryStatus.textContent=result.errors&&result.errors.length?personalText([`${result.errors.length} fonte(s) indisponível(is).`,`${result.errors.length} source(s) unavailable.`,`${result.errors.length} fuente(s) no disponible(s).`]):personalText(['Consulta concluída.','Query complete.','Consulta finalizada.']);renderPersonalSuggestions(result.suggestions,result.errors,undefined,result.diagnostics);
      }catch(e){personalError(e);}finally{E.personalRun.disabled=false;}
    }
    function decodePersonalPolyline6(encoded,maxCoordinates=50000){if(typeof encoded!=='string'||encoded.length<2||encoded.length>2000000||!Number.isSafeInteger(maxCoordinates)||maxCoordinates<2)return[];const coordinates=[];let index=0,lat=0,lng=0,decoded=0;const read=()=>{let result=0,shift=0,b;do{if(index>=encoded.length||shift>50)throw new Error('invalid polyline');b=encoded.charCodeAt(index++)-63;if(b<0||b>63)throw new Error('invalid polyline');result+=(b&31)*Math.pow(2,shift);shift+=5;}while(b>=32);return(result&1)?-((result+1)/2):result/2;};while(index<encoded.length&&decoded<maxCoordinates){decoded++;lat+=read();lng+=read();const y=lat/1e6,x=lng/1e6;if(Number.isFinite(x)&&Number.isFinite(y)&&x>=-180&&x<=180&&y>=-90&&y<=90)coordinates.push([x,y]);}return coordinates;}
    function personalRouteFeatures(rows,maxCoordinates=100000){const features=[];let remaining=maxCoordinates;(rows||[]).forEach(s=>{if(remaining<2)return;const legs=s.candidate&&s.candidate.data&&s.candidate.data.legs;if(!Array.isArray(legs))return;legs.forEach((leg,index)=>{if(remaining<2)return;try{const coordinates=decodePersonalPolyline6(leg&&leg.encodedPolyline,Math.min(50000,remaining));remaining-=coordinates.length;if(coordinates.length>1)features.push({type:'Feature',properties:{title:String(s.candidate.title||''),suggestionId:String(s.id||''),leg:index},geometry:{type:'LineString',coordinates}});}catch(e){}});});return features;}
    function destroyPersonalMap(){if(personalMapInstance){try{personalMapInstance.remove();}catch(e){}personalMapInstance=null;}}
    async function renderPersonalMap(){if(!E.personalMap||E.personalMap.classList.contains('hidden'))return;const points=personalSuggestions.filter(s=>{const p=s&&s.candidate&&s.candidate.point;return p&&Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lng))&&Number(p.lat)>=-90&&Number(p.lat)<=90&&Number(p.lng)>=-180&&Number(p.lng)<=180;}).slice(0,500),routes=personalRouteFeatures(personalSuggestions),origins=routes.map(route=>route.geometry.coordinates[0]).filter(Boolean),allCoordinates=[...points.map(s=>[Number(s.candidate.point.lng),Number(s.candidate.point.lat)]),...routes.flatMap(f=>f.geometry.coordinates)];if(!allCoordinates.length){destroyPersonalMap();E.personalMap.innerHTML='<div class="personal-map-empty">'+esc(personalText(['Os resultados atuais não têm coordenadas para o mapa.','Current results have no coordinates for the map.','Los resultados actuales no tienen coordenadas para el mapa.']))+'</div>';return;}try{if(!personalMapModule)personalMapModule=await import('/vendor/context/maplibre-gl.mjs');if(!personalPmtilesProtocol&&window.pmtiles&&window.pmtiles.Protocol){personalPmtilesProtocol=new window.pmtiles.Protocol();personalMapModule.addProtocol('pmtiles',personalPmtilesProtocol.tile);}if(!personalMapInstance){E.personalMap.innerHTML='';let style={version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#10151d'}}]};try{const r=await fetch('/context/maps/style.json');if(r.ok)style=await r.json();}catch(e){}personalMapInstance=new personalMapModule.Map({container:E.personalMap,style,center:allCoordinates[0],zoom:12,attributionControl:true});await new Promise(resolve=>personalMapInstance.loaded()?resolve():personalMapInstance.once('load',resolve));}const routeGeo={type:'FeatureCollection',features:routes},originGeo={type:'FeatureCollection',features:origins.map((coordinates,index)=>({type:'Feature',properties:{label:personalText(['Origem','Origin','Origen']),index},geometry:{type:'Point',coordinates}}))},pointGeo={type:'FeatureCollection',features:points.map(s=>({type:'Feature',properties:{title:String(s.candidate.title||''),suggestionId:String(s.id||''),state:String(s.candidate&&s.candidate.data&&s.candidate.data.state||''),summary:personalCandidateSummary(s)},geometry:{type:'Point',coordinates:[Number(s.candidate.point.lng),Number(s.candidate.point.lat)]}}))};if(personalMapInstance.getSource('jarvis-routes'))personalMapInstance.getSource('jarvis-routes').setData(routeGeo);else{personalMapInstance.addSource('jarvis-routes',{type:'geojson',data:routeGeo});personalMapInstance.addLayer({id:'jarvis-routes-line',type:'line',source:'jarvis-routes',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#4f83ff','line-width':5,'line-opacity':.86}});}if(personalMapInstance.getSource('jarvis-origins'))personalMapInstance.getSource('jarvis-origins').setData(originGeo);else{personalMapInstance.addSource('jarvis-origins',{type:'geojson',data:originGeo});personalMapInstance.addLayer({id:'jarvis-origins-circle',type:'circle',source:'jarvis-origins',paint:{'circle-radius':7,'circle-color':'#f6c344','circle-stroke-width':3,'circle-stroke-color':'#171b22'}});}if(personalMapInstance.getSource('jarvis-results'))personalMapInstance.getSource('jarvis-results').setData(pointGeo);else{personalMapInstance.addSource('jarvis-results',{type:'geojson',data:pointGeo});personalMapInstance.addLayer({id:'jarvis-results-circle',type:'circle',source:'jarvis-results',paint:{'circle-radius':7,'circle-color':'#35c978','circle-stroke-width':2,'circle-stroke-color':'#ffffff'}});personalMapInstance.on('mouseenter','jarvis-results-circle',()=>{personalMapInstance.getCanvas().style.cursor='pointer';});personalMapInstance.on('mouseleave','jarvis-results-circle',()=>{personalMapInstance.getCanvas().style.cursor='';});personalMapInstance.on('click','jarvis-results-circle',event=>{const id=event.features&&event.features[0]&&event.features[0].properties&&event.features[0].properties.suggestionId,suggestion=personalSuggestionById(String(id||''));if(!suggestion)return;const content=document.createElement('div'),title=document.createElement('b'),meta=document.createElement('div'),sources=document.createElement('div'),save=personalButton(t('saveAsFavorite'),()=>personalSaveSuggestionAsFavorite(suggestion,E.personalPurpose.value));title.textContent=String(suggestion.candidate&&suggestion.candidate.title||'');meta.textContent=personalCandidateSummary(suggestion);sources.className='personal-sources';appendPersonalSources(sources,suggestion);content.append(title,meta,sources,save);new personalMapModule.Popup({closeButton:true,maxWidth:'320px'}).setLngLat(event.lngLat).setDOMContent(content).addTo(personalMapInstance);});}const bounds=new personalMapModule.LngLatBounds();allCoordinates.forEach(c=>bounds.extend(c));personalMapInstance.resize();personalMapInstance.fitBounds(bounds,{padding:36,maxZoom:15,duration:0});}catch(e){destroyPersonalMap();E.personalMap.innerHTML='<div class="personal-map-empty">'+esc(personalText(['Mapa local indisponível; use a lista.','Local map unavailable; use the list.','Mapa local no disponible; usa la lista.']))+'</div>';}}
    function personalPreviewKey(key){const labels={title:['Título','Title','Título'],label:['Nome','Label','Nombre'],url:['Destino','Destination','Destino'],destination:['Destino','Destination','Destino'],operation:['Operação','Operation','Operación'],calendar:['Agenda','Calendar','Calendario'],eventHref:['Evento','Event','Evento'],uid:['UID','UID','UID'],startAt:['Início','Start','Inicio'],endAt:['Fim','End','Fin'],timeZone:['Fuso horário','Time zone','Zona horaria'],location:['Local','Location','Lugar'],remindersMinutes:['Lembretes (min)','Reminders (min)','Recordatorios (min)'],consequence:['Consequência','Consequence','Consecuencia'],concurrencyProtected:['Proteção contra conflito','Conflict protection','Protección contra conflictos'],undoToken:['Autorização de desfazer','Undo authorization','Autorización para deshacer'],durability:['Durabilidade','Durability','Durabilidad'],requiresFreshResource:['Recurso atual exigido','Fresh resource required','Recurso actual requerido'],entityId:['Entidade','Entity','Entidad'],service:['Serviço','Service','Servicio']};return personalText(labels[key]||[key,key,key]);}
    function personalPreviewValue(key,value){if(['startAt','endAt'].includes(key)&&Number.isFinite(Number(value)))return new Date(Number(value)).toLocaleString();if(key==='undoToken')return personalText(['Protegida','Protected','Protegida']);if(value===null||value===undefined)return'—';if(key==='calendar'&&typeof value==='object')return String(value.label||value.href||'');return typeof value==='object'?JSON.stringify(value):String(value);}
    function personalActionReconciliationInfo(state,kind=''){if(state==='uncertain')return{title:t('actionStateUncertain'),body:t('actionStateUncertainBody')};if(state==='reconciliation_required')return{title:t('actionStateReconciliation'),body:t('actionStateReconciliationBody')};if(state==='failed')return{title:t(kind==='navigation.open'?'navigationOpenFailed':'actionStateFailed'),body:''};return null;}
    function personalActionClientAckDeadline(action){const deadline=Number(action&&action.clientAckExpiresAt),fallback=Number(action&&action.expiresAt);return Number.isFinite(deadline)?deadline:Number.isFinite(fallback)?fallback:0;}
    function personalClearActionAckWatch(reset=true){if(personalActionAckTimer){clearTimeout(personalActionAckTimer);personalActionAckTimer=null;}if(reset){personalActionAckWatchKey='';personalActionAckChecks=0;personalActionAckExhausted=false;}}
    function personalActionAckKey(action){return`${String(action&&action.id||'')}:${personalActionClientAckDeadline(action)}`;}
    function personalActionLocalizedError(action){const error=String(action&&action.error||'').trim();if(!error)return'';if(action.kind==='navigation.open'){if(action.state==='uncertain')return t('navigationAckExpired');if(action.state==='failed')return'';}return error;}
    function personalActionStatusInfo(action){const state=String(action&&action.state||''),reconciliation=personalActionReconciliationInfo(state,action&&action.kind);if(reconciliation)return{...reconciliation,kind:state,error:personalActionLocalizedError(action)};if(state==='running'&&action.awaitingClientAck===true){const deadline=personalActionClientAckDeadline(action),key=personalActionAckKey(action);if(personalActionAckExhausted&&personalActionAckWatchKey===key)return{title:t('actionClientAckUnavailable'),body:t('actionStateUncertainBody'),kind:'client-failed',error:''};if(deadline&&Date.now()>=deadline)return{title:t('actionClientAckChecking'),body:'',kind:'running',error:''};return{title:t('actionAwaitingClientAck'),body:deadline?`${t('actionClientAckDeadline')} ${new Date(deadline).toLocaleString()}`:'',kind:'running',error:''};}return null;}
    function personalWatchActionClientAck(action){const waiting=action&&action.state==='running'&&action.awaitingClientAck===true,deadline=personalActionClientAckDeadline(action);if(!waiting||!deadline){personalClearActionAckWatch();return;}const key=personalActionAckKey(action);if(key!==personalActionAckWatchKey){personalClearActionAckWatch();personalActionAckWatchKey=key;}if(personalActionAckTimer||personalActionAckExhausted)return;const delay=personalActionAckChecks===0?Math.max(0,deadline-Date.now()+250):Math.min(2000,500*(2**(personalActionAckChecks-1)));personalActionAckTimer=setTimeout(()=>personalRefreshActionAfterAckDeadline(action.id,key),Math.min(2147483647,delay));}
    async function personalRefreshActionAfterAckDeadline(planId,watchKey){if(watchKey!==personalActionAckWatchKey)return;personalActionAckTimer=null;if(!personalActiveAction||personalActiveAction.id!==planId||E.personalActionModal.classList.contains('hidden')){personalClearActionAckWatch();return;}personalActionAckChecks++;personalShowActionClientState(t('actionClientAckChecking'),'running');try{const response=await personalRequest({t:'personal_context_get',requestId:personalReqId()},5000);if(watchKey!==personalActionAckWatchKey)return;const state=response&&response.state||personalState,updated=state&&Array.isArray(state.actions)&&state.actions.find(action=>action.id===planId);if(!updated)throw new Error(t('actionClientAckUnavailable'));personalActiveAction=updated;if(updated.state==='succeeded'&&updated.awaitingClientAck===false){toast(t('navigationOpened'));closePersonalAction();return;}if(updated.state==='running'&&updated.awaitingClientAck===true&&personalActionAckChecks>=3)personalActionAckExhausted=true;openPersonalAction(updated,personalActiveActionNote,undefined,false);}catch(e){if(watchKey!==personalActionAckWatchKey)return;if(personalActionAckChecks>=3)personalActionAckExhausted=true;openPersonalAction(personalActiveAction,personalActiveActionNote,undefined,false);}}
    function openPersonalAction(action,note='',returnFocus,focus=true){if(E.personalActionModal.classList.contains('hidden'))personalActionReturnFocus=returnFocus||document.activeElement;personalActiveAction=action;personalActiveActionNote=note||'';personalWatchActionClientAck(action);const risk=action.risk||'consequential',state=String(action.state||''),status=personalActionStatusInfo(action),reconciliation=personalActionReconciliationInfo(state,action.kind);E.personalActionTitle.textContent=String(action.preview&&action.preview.title||action.kind);E.personalActionRisk.className='personal-note risk-'+risk;E.personalActionRisk.textContent=personalText(personalRiskLabels[risk]||[risk,risk,risk]);E.personalActionState.className='personal-action-state'+(status?' '+status.kind:' hidden');E.personalActionState.textContent=status?[status.title,status.body,status.error].filter(Boolean).join(' '):'';E.personalActionPreview.innerHTML='';Object.entries(action.preview||{}).forEach(([k,v])=>{const dt=document.createElement('dt');dt.textContent=personalPreviewKey(k);const dd=document.createElement('dd');dd.textContent=personalPreviewValue(k,v);E.personalActionPreview.append(dt,dd);});if(personalActiveActionNote){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=t('assumption');dd.textContent=personalActiveActionNote;E.personalActionPreview.append(dt,dd);}const expiresAt=Number(action.expiresAt);E.personalActionExpiry.textContent=Number.isFinite(expiresAt)?personalText(['Expira em ','Expires at ','Expira a las '])+new Date(expiresAt).toLocaleString():'';const needs=action.requiresConfirmation!==false&&state==='pending',canExecute=!reconciliation&&!needs&&['pending','approved'].includes(state),canCancel=['pending','approved','running'].includes(state);E.personalActionApprove.classList.toggle('hidden',!needs);E.personalActionExecute.classList.toggle('hidden',!canExecute);E.personalActionCancel.dataset.personalCommand=canCancel?'cancel':'close';E.personalActionCancel.dataset.i18n=canCancel?'cancel':'close';E.personalActionCancel.textContent=t(canCancel?'cancel':'close');E.personalActionModal.classList.remove('hidden');if(focus)setTimeout(()=>E.personalActionClose.focus(),20);}
    function closePersonalAction(){personalClearActionAckWatch();E.personalActionModal.classList.add('hidden');personalActiveAction=null;personalActiveActionNote='';const target=personalActionReturnFocus;personalActionReturnFocus=null;restorePersonalFocus(target);}
    function personalCalendarUndoSource(action){const match=/^calendar\.caldav:(.+):(create|update|delete|undo)$/.exec(String(action&&action.kind||''));if(!match)return null;return personalCalDavSources('external_reversible:calendar.undo').find(source=>source.id===match[1])||null;}
    function showPersonalCalendarUndo(action){const undo=action&&action.result&&action.result.undo,source=personalCalendarUndoSource(action),token=undo&&undo.available&&typeof undo.token==='string'&&undo.token.length<=128?undo.token:'';if(!source||!token)return;const box=document.createElement('div');box.className='toast personal-notification-toast';box.setAttribute('role','region');box.setAttribute('aria-label',t('undoCalendarAction'));const copy=document.createElement('div');copy.className='personal-notification-copy';const title=document.createElement('b'),body=document.createElement('span');title.textContent=t('undoCalendarAction');body.textContent=t('undoAvailable');copy.append(title,body);const actions=document.createElement('div');actions.className='personal-notification-actions';const close=()=>{if(box.parentNode)box.remove();},undoButton=personalButton(t('undoCalendarAction'),()=>{close();previewPersonalCalendarOperation(source,'undo',{undoToken:token});}),dismiss=personalButton(t('notificationDismiss'),close);actions.append(undoButton,dismiss);box.append(copy,actions);document.body.appendChild(box);setTimeout(close,60000);}
    function personalShowActionClientState(message,kind='client-failed'){E.personalActionState.className=`personal-action-state ${kind}`;E.personalActionState.textContent=message;E.personalActionState.classList.remove('hidden');}
    function personalReserveNavigationWindow(){
      let popup=null;try{popup=window.open('about:blank','_blank');}catch(e){}
      if(!popup||popup.closed){personalShowActionClientState(t('popupBlocked'));E.personalActionExecute.focus();return null;}
      try{popup.opener=null;popup.document.documentElement.lang=lang;popup.document.title=t('openingNavigation');popup.document.body.textContent=t('openingNavigation');popup.document.body.style.cssText='margin:0;min-height:100vh;display:grid;place-items:center;background:#10151d;color:#d8e1ec;font:16px system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box';}catch(e){}
      return{popup,navigated:false};
    }
    function personalCloseNavigationWindow(reservation){try{if(reservation&&reservation.popup&&!reservation.popup.closed)reservation.popup.close();}catch(e){}}
    async function personalReportNavigationHandoff(action,success,error){const response=await personalRequest({t:'personal_action_handoff_result',requestId:personalReqId(),planId:action.id,success,...(error?{error:String(error).slice(0,1000)}:{})});if(!response||!response.action||response.action.id!==action.id)throw new Error(t('navigationAckInvalid'));return response;}
    async function personalCompleteNavigationHandoff(action,reservation){
      const handoff=action&&action.result&&action.result.handoff;let failure='';
      try{if(action.state!=='running'||action.awaitingClientAck!==true||typeof action.executionDeviceId!=='string'||!action.executionDeviceId||action.result.requiresClientAck!==true||typeof handoff!=='string')throw new Error(t('navigationOpenFailed'));const url=new URL(handoff);if(!['https:','geo:'].includes(url.protocol))throw new Error(t('navigationOpenFailed'));if(!reservation||!reservation.popup||reservation.popup.closed)throw new Error(t('popupBlocked'));reservation.popup.location.href=url.toString();reservation.navigated=true;}catch(e){failure=String((e&&e.message)||e||t('navigationOpenFailed'));}
      if(failure){personalCloseNavigationWindow(reservation);return personalReportNavigationHandoff(action,false,failure);}
      return personalReportNavigationHandoff(action,true);
    }
    function personalExecuteActionFromClick(){if(!personalActiveAction)return;if(personalActiveAction.kind!=='navigation.open'){personalActionCommand('execute');return;}const reservation=personalReserveNavigationWindow();if(!reservation)return;personalActionCommand('execute',reservation);}
    async function personalActionCommand(kind,navigationReservation){
      if(!personalActiveAction)return;if(kind==='execute'&&personalActionReconciliationInfo(personalActiveAction.state,personalActiveAction.kind)){openPersonalAction(personalActiveAction,personalActiveActionNote);return;}const initial=personalActiveAction,navigation=kind==='execute'&&initial.kind==='navigation.open';E.personalActionApprove.disabled=true;E.personalActionExecute.disabled=true;E.personalActionCancel.disabled=true;
      try{
        let result;if(kind==='approve')result=await personalRequest({t:'personal_action_approve',requestId:personalReqId(),planId:initial.id,challenge:initial.confirmationChallenge});else if(kind==='execute')result=await personalRequest({t:'personal_action_execute',requestId:personalReqId(),planId:initial.id});else result=await personalRequest({t:'personal_action_cancel',requestId:personalReqId(),planId:initial.id});personalActiveAction=result.action;
        if(navigation){if(!result.action||result.action.id!==initial.id)throw new Error(t('navigationAckInvalid'));openPersonalAction(result.action,personalActiveActionNote);personalShowActionClientState(t('openingNavigation'),'running');E.personalActionCancel.disabled=true;const acknowledgement=await personalCompleteNavigationHandoff(result.action,navigationReservation);personalActiveAction=acknowledgement.action;const finalState=acknowledgement.action&&acknowledgement.action.state,confirmed=finalState==='succeeded'&&acknowledgement.action.awaitingClientAck===false;if(confirmed){toast(t('navigationOpened'));closePersonalAction();}else{openPersonalAction(acknowledgement.action,personalActiveActionNote);toast(t('navigationOpenFailed'));}requestPersonalState();return;}
        const reconciliation=personalActionReconciliationInfo(result.action&&result.action.state,result.action&&result.action.kind);if(kind==='approve'||reconciliation){openPersonalAction(result.action,personalActiveActionNote);if(reconciliation)toast(reconciliation.title);requestPersonalState();return;}
        toast(result.action.state==='succeeded'?personalText(['Ação concluída.','Action complete.','Acción finalizada.']):personalText(['Ação atualizada.','Action updated.','Acción actualizada.']));const offerUndo=kind==='execute'&&result.action.state==='succeeded';closePersonalAction();if(offerUndo)showPersonalCalendarUndo(result.action);requestPersonalState();
      }catch(e){if(navigation&&!navigationReservation?.navigated)personalCloseNavigationWindow(navigationReservation);personalError(e);if(personalActiveAction)openPersonalAction(personalActiveAction,personalActiveActionNote);}finally{E.personalActionApprove.disabled=false;E.personalActionExecute.disabled=false;E.personalActionCancel.disabled=false;}
    }
    const personalCsv=value=>String(value||'').split(',').map(x=>x.trim()).filter(Boolean);
    const personalSourceKnownConfigKeys=new Set(['certification','format','access','timeZone','attribution','purposes','args','cwd','attributes','serviceDataFields','allowRemoteHttps','outputSchema']);
    const personalEnvironmentName=/^[A-Za-z_][A-Za-z0-9_]*$/;
    const personalSensitiveEnvironment=/(^|_)(authorization|cookie|credential|passwd|password|secret|token|api_?key|private_?key)($|_)/i;
    function personalPrettyOutputSchema(raw){if(typeof raw!=='string'||!raw.trim())return'';try{const pretty=JSON.stringify(JSON.parse(raw),null,2);return pretty.length<=2000?pretty:raw;}catch(e){return raw;}}
    function renderPersonalSourceEnvironment(){
      if(!E.personalSourceEnvList)return;
      E.personalSourceEnvList.innerHTML='';
      [...personalSourceEnvironment.entries()].sort(([a],[b])=>a.localeCompare(b)).forEach(([name,entry])=>{
        const item=document.createElement('span');item.className='personal-env-item';
        const key=document.createElement('span'),state=document.createElement('small');key.textContent=name;state.textContent=t(entry.pending?'envValuePending':'envValueHidden');
        const remove=personalButton(t('remove'),()=>{personalSourceEnvironment.delete(name);renderPersonalSourceEnvironment();});
        remove.setAttribute('aria-label',`${t('removeEnvironment')}: ${name}`);
        item.append(key,state,remove);E.personalSourceEnvList.appendChild(item);
      });
    }
    function personalAddSourceEnvironment(){
      try{
        const name=E.personalSourceEnvName.value.trim(),value=E.personalSourceEnvValue.value;
        if(!personalEnvironmentName.test(name))throw new Error(t('invalidEnvName'));
        if(personalSensitiveEnvironment.test(name))throw new Error(t('sensitiveEnvRejected'));
        if(!value)throw new Error(t('envValueRequired'));
        if(value.length>2000||/[\u0000-\u001f\u007f]/.test(value))throw new Error(t('envValueRequired'));
        personalSourceEnvironment.set(name,{value,pending:true});
        E.personalSourceEnvName.value='';E.personalSourceEnvValue.value='';renderPersonalSourceEnvironment();E.personalSourceEnvName.focus();
      }catch(e){personalError(e);}
    }
    function personalMcpToolNames(actions){return(actions||[]).map(raw=>/^(?:read|local_reversible|external_reversible|consequential):([A-Za-z0-9_.:/-]{1,150})$/.exec(raw)).filter(Boolean).map(match=>match[1]);}
    function personalSourceTypeUi(){
      const type=E.personalSourceType.value,isStdio=type==='mcp_stdio',isMcp=isStdio||type==='mcp_http',isCalDav=type==='caldav',details=isCalDav&&E.personalSourceAccess.value==='details';
      E.personalSourceEndpoint.type='text';E.personalSourceEndpoint.placeholder=isStdio?personalText(['Caminho do executável','Executable path','Ruta del ejecutable']):'https://...';
      E.personalSourceResources.placeholder=isCalDav?personalText(['/calendars/pessoal/','/calendars/personal/','/calendars/personal/']):t('allowedResourcesPh');
      E.personalSourceActions.placeholder=isCalDav?'external_reversible:calendar.create, external_reversible:calendar.update, consequential:calendar.delete, external_reversible:calendar.undo':t('allowedActionsPh');
      if(E.personalSourceAccessRow)E.personalSourceAccessRow.classList.toggle('hidden',!isCalDav);
      if(E.personalSourceOutputSchemaRow)E.personalSourceOutputSchemaRow.classList.toggle('hidden',!isMcp);
      if(E.personalSourceEnvGroup)E.personalSourceEnvGroup.classList.toggle('hidden',!isStdio);
      const hints={mcp_http:['Use recursos URI e ações como read:tool, external_reversible:tool ou consequential:tool. MCP HTTP não certificado fica bloqueado.','Use resource URIs and actions such as read:tool, external_reversible:tool or consequential:tool. Uncertified HTTP MCP stays blocked.','Usa URIs de recursos y acciones como read:tool, external_reversible:tool o consequential:tool. MCP HTTP no certificado queda bloqueado.'],mcp_stdio:['O endpoint é o executável. Iniciar MCP local executa um processo; configure argumentos, pasta e allowlists.','Endpoint is the executable. Starting local MCP runs a process; configure arguments, working directory and allowlists.','El endpoint es el ejecutable. Iniciar MCP local ejecuta un proceso; configura argumentos, carpeta y allowlists.'],home_assistant:['Recursos são entity_id. Ações: risco:dominio.servico@entidade1|entidade2. Locks, alarmes e portões devem ser consequential.','Resources are entity_id values. Actions: risk:domain.service@entity1|entity2. Locks, alarms and gates must be consequential.','Los recursos son entity_id. Acciones: riesgo:dominio.servicio@entidad1|entidad2. Cerraduras, alarmas y portones deben ser consequential.'],weather_alerts:['Use somente um feed CAP HTTPS da autoridade responsável e marque a fonte como primeira parte ou auditada.','Use only an HTTPS CAP feed from the responsible authority and mark the source as first-party or audited.','Usa solamente un feed CAP HTTPS de la autoridad responsable y marca la fuente como primera parte o auditada.'],caldav:details?[`${t('calendarDetailsConsentNote')} Informe cada calendarHref permitido e os grants exatos de criar, editar, excluir e desfazer.`,`${t('calendarDetailsConsentNote')} Enter each allowed calendarHref and the exact create, update, delete and undo grants.`,`${t('calendarDetailsConsentNote')} Indica cada calendarHref permitido y los grants exactos para crear, editar, eliminar y deshacer.`]:['Informe cada calendarHref permitido e os grants exatos de criar, editar, excluir e desfazer. Busy/free continua sendo o acesso padrão.','Enter each allowed calendarHref and the exact create, update, delete and undo grants. Busy/free remains the default.','Indica cada calendarHref permitido y los grants exactos para crear, editar, eliminar y deshacer. Ocupado/libre sigue siendo el valor predeterminado.'],open_events:['Escolha ICS, RSS/Atom ou JSON-LD; deixe em detectar quando a URL indicar o formato.','Choose ICS, RSS/Atom or JSON-LD; keep auto-detect when the URL identifies the format.','Elige ICS, RSS/Atom o JSON-LD; deja detección automática si la URL indica el formato.']};
      E.personalSourceHint.textContent=personalText(hints[type]||['Use endpoint local/autohospedado quando disponível.','Use a local/self-hosted endpoint when available.','Usa endpoint local/autohospedado cuando esté disponible.']);
    }
    function personalClearSourceDiscovery(){if(!E.personalSourceDiscovery)return;E.personalSourceDiscovery.innerHTML='';E.personalSourceDiscovery.classList.add('hidden');}
    function personalSetDiscoveredResource(href,selected){const values=personalCsv(E.personalSourceResources.value).filter(value=>value!==href);if(selected)values.push(href);E.personalSourceResources.value=[...new Set(values)].join(', ');}
    function personalDiscoveryStateLabel(value){return personalText(({ready:['Pronta','Ready','Lista'],awaiting_start:['Aguardando inicialização','Awaiting start','Esperando inicio'],disconnected:['Desconectada','Disconnected','Desconectada'],connecting:['Conectando','Connecting','Conectando'],connected:['Conectada','Connected','Conectada'],closing:['Encerrando','Closing','Cerrando']})[value]||[value,value,value]);}
    function personalDiscoveryHealthLabel(value){return personalText(({healthy:['Saudável','Healthy','Saludable'],unhealthy:['Com falha','Unhealthy','Con fallas'],unknown:['Saúde desconhecida','Unknown health','Salud desconocida']})[value]||[value,value,value]);}
    function personalRenderDiscoveryGroup(parent,title,rows,{selectable=false}={}){if(!rows.length)return;const group=document.createElement('div'),heading=document.createElement('b');group.className='personal-source-discovery-group';heading.textContent=title;group.appendChild(heading);const selected=new Set(personalCsv(E.personalSourceResources.value));rows.forEach(row=>{const item=document.createElement(selectable?'label':'div'),copy=document.createElement('span'),name=document.createElement('b'),description=document.createElement('span'),state=document.createElement('span');item.className='personal-source-discovery-item';copy.className='personal-source-discovery-copy';state.className='personal-source-discovery-state';name.textContent=String(row.name||row.href||row.id||'');description.textContent=[row.description,row.href&&row.href!==row.name?row.href:'',row.mime].filter(Boolean).join(' · ');copy.append(name,description);if(selectable){const input=document.createElement('input'),href=String(row.href||'');input.type='checkbox';input.checked=selected.has(href)||row.allowed===true;input.setAttribute('aria-label',`${title}: ${name.textContent}`);input.onchange=()=>personalSetDiscoveredResource(href,input.checked);item.append(input,copy);}else{const marker=document.createElement('span');marker.className='personal-status '+(row.allowed?'ready':'degraded');marker.setAttribute('aria-hidden','true');item.append(marker,copy);}state.textContent=row.allowed?t('discoveryAllowed'):t('discoveryAvailable');item.appendChild(state);group.appendChild(item);});parent.appendChild(group);}
    function personalRenderSourceDiscovery(discovery){if(!E.personalSourceDiscovery)return;const panel=E.personalSourceDiscovery;panel.innerHTML='';panel.classList.remove('hidden');const head=document.createElement('div'),title=document.createElement('b'),status=document.createElement('span');head.className='personal-source-discovery-head';title.textContent=t('sourceDiscovery');status.className='personal-note';status.textContent=[personalDiscoveryStateLabel(discovery.state),personalDiscoveryHealthLabel(discovery.health),Number.isFinite(discovery.latencyMs)?`${discovery.latencyMs} ms`:''].filter(Boolean).join(' · ');head.append(title,status);panel.appendChild(head);if(discovery.state==='awaiting_start'){const note=document.createElement('span');note.className='personal-note';note.textContent=t('mcpAwaitingStart');panel.appendChild(note);}personalRenderDiscoveryGroup(panel,t('discoveredCalendars'),discovery.calendars||[],{selectable:true});personalRenderDiscoveryGroup(panel,t('discoveredResources'),discovery.resources||[],{selectable:true});personalRenderDiscoveryGroup(panel,t('discoveredTools'),discovery.tools||[]);const total=(discovery.calendars||[]).length+(discovery.resources||[]).length+(discovery.tools||[]).length;if(!total){const empty=document.createElement('span');empty.className='personal-note';empty.textContent=t('sourceDiscoveryEmpty');panel.appendChild(empty);}if(discovery.truncated&&Object.values(discovery.truncated).some(Boolean)){const note=document.createElement('span');note.className='personal-note';note.textContent=t('discoveryTruncated');panel.appendChild(note);}const scroller=panel.closest('.settings-panels');if(scroller){const panelRect=panel.getBoundingClientRect(),scrollerRect=scroller.getBoundingClientRect();if(panelRect.bottom>scrollerRect.bottom)scroller.scrollTop+=panelRect.bottom-scrollerRect.bottom+12;else if(panelRect.top<scrollerRect.top)scroller.scrollTop-=scrollerRect.top-panelRect.top+12;}}
    async function personalDiscoverSource(row,button){const old=button&&button.textContent;if(button){button.disabled=true;button.textContent=t('sourceDiscovering');}try{if(row.connection)personalEditSource(row.connection);if(E.personalSourceDiscovery){E.personalSourceDiscovery.classList.remove('hidden');E.personalSourceDiscovery.textContent=t('sourceDiscovering');}const result=await personalRequest({t:'personal_source_discover',requestId:personalReqId(),sourceId:row.id},30000);personalRenderSourceDiscovery(result.discovery);}catch(e){personalClearSourceDiscovery();personalError(new Error(t('sourceDiscoveryFailed')));}finally{if(button&&button.isConnected){button.disabled=false;button.textContent=old||t('discoverSource');}}}
    function personalEditSource(source){
      personalClearSourceDiscovery();const c=source.config||{};personalSourceEditing=source.id;personalSourceEditingConfig={};personalSourceEnvironment.clear();personalSourceConfiguredEnvNames=new Set(Array.isArray(source.configuredEnvNames)?source.configuredEnvNames.filter(name=>personalEnvironmentName.test(name)):[]);
      personalSourceConfiguredEnvNames.forEach(name=>personalSourceEnvironment.set(name,{value:'',pending:false}));
      Object.entries(c).forEach(([key,value])=>{if(!key.startsWith('env.'))personalSourceEditingConfig[key]=value;});
      E.personalSourceType.value=source.type;E.personalSourceLabel.value=source.label||'';E.personalSourceEndpoint.value=source.endpoint||'';E.personalSourceSecret.value='';E.personalSourceSecret.placeholder=source.hasSecret?personalText(['Configurada; deixe vazio para manter','Configured; leave blank to keep','Configurada; deja vacío para mantener']):'JARVIS_...';E.personalSourceResources.value=(source.allowedResources||[]).join(', ');E.personalSourceActions.value=(source.allowedActions||[]).join(', ');E.personalSourceCertification.value=c.certification||'uncertified';E.personalSourceFormat.value=c.format||'';E.personalSourceAccess.value=c.access||'busy_free';E.personalSourceTimeZone.value=c.timeZone||'';E.personalSourceAttribution.value=c.attribution||'';E.personalSourcePurposes.value=Array.isArray(c.purposes)?c.purposes.join(', '):(c.purposes||'');E.personalSourceArgs.value=Array.isArray(c.args)?c.args.join(', '):(c.args||'');E.personalSourceCwd.value=c.cwd||'';E.personalSourceAttributes.value=Array.isArray(c.attributes)?c.attributes.join(', '):(c.attributes||'');E.personalSourceServiceFields.value=Array.isArray(c.serviceDataFields)?c.serviceDataFields.join(', '):(c.serviceDataFields||'');E.personalSourceOutputSchema.value=personalPrettyOutputSchema(c.outputSchema);E.personalSourceEnvName.value='';E.personalSourceEnvValue.value='';E.personalSourceRemoteHttps.checked=!!c.allowRemoteHttps;E.personalSourceEnabled.checked=source.enabled!==false;renderPersonalSourceEnvironment();personalSourceTypeUi();E.personalSourceLabel.focus();
    }
    function personalResetSource(){personalClearSourceDiscovery();personalSourceEditing='';personalSourceEditingConfig={};personalSourceEnvironment.clear();personalSourceConfiguredEnvNames=new Set();E.personalSourceLabel.value='';E.personalSourceEndpoint.value='';E.personalSourceSecret.value='';E.personalSourceSecret.placeholder='JARVIS_...';E.personalSourceResources.value='';E.personalSourceActions.value='';E.personalSourceCertification.value='uncertified';E.personalSourceFormat.value='';E.personalSourceAccess.value='busy_free';E.personalSourceTimeZone.value='';E.personalSourceAttribution.value='';E.personalSourcePurposes.value='';E.personalSourceArgs.value='';E.personalSourceCwd.value='';E.personalSourceAttributes.value='';E.personalSourceServiceFields.value='';E.personalSourceOutputSchema.value='';E.personalSourceEnvName.value='';E.personalSourceEnvValue.value='';E.personalSourceRemoteHttps.checked=false;E.personalSourceEnabled.checked=true;renderPersonalSourceEnvironment();personalSourceTypeUi();}
    function personalSourceConfig(){
      const type=E.personalSourceType.value,isMcp=type==='mcp_http'||type==='mcp_stdio',config={};
      Object.entries(personalSourceEditingConfig).forEach(([key,value])=>{if(!personalSourceKnownConfigKeys.has(key)&&!key.startsWith('env.')&&(!key.startsWith('outputSchema.')||isMcp))config[key]=value;});
      const put=(key,value)=>{if(Array.isArray(value)?value.length:String(value||'').trim())config[key]=value;};
      put('certification',E.personalSourceCertification.value);put('format',E.personalSourceFormat.value);put('access',E.personalSourceAccess.value);put('timeZone',E.personalSourceTimeZone.value.trim());put('attribution',E.personalSourceAttribution.value.trim());put('purposes',personalCsv(E.personalSourcePurposes.value));put('args',personalCsv(E.personalSourceArgs.value));put('cwd',E.personalSourceCwd.value.trim());put('attributes',personalCsv(E.personalSourceAttributes.value));put('serviceDataFields',personalCsv(E.personalSourceServiceFields.value));if(E.personalSourceRemoteHttps.checked)config.allowRemoteHttps=true;
      if(isMcp){
        const raw=E.personalSourceOutputSchema.value.trim();
        if(raw){let schema;try{schema=JSON.parse(raw);}catch(e){throw new Error(t('outputSchemaInvalid'));}if(!schema||typeof schema!=='object'||Array.isArray(schema))throw new Error(t('outputSchemaObject'));if(schema.type!=='object'||schema.additionalProperties!==false||!schema.properties||typeof schema.properties!=='object'||Array.isArray(schema.properties))throw new Error(t('outputSchemaClosed'));const normalized=JSON.stringify(schema);if(normalized.length>2000)throw new Error(t('sourceConfigTooLarge'));config.outputSchema=normalized;}
        const tools=personalMcpToolNames(personalCsv(E.personalSourceActions.value));if(tools.some(name=>!config.outputSchema&&!config[`outputSchema.${name}`]))throw new Error(t('outputSchemaRequired'));
      }
      if(Object.keys(config).length>50||JSON.stringify(config).length>32768)throw new Error(t('sourceConfigTooLarge'));
      return config;
    }
    function personalStdioEnvironmentPatch(type){if(type!=='mcp_stdio')return undefined;const set={};personalSourceEnvironment.forEach((entry,name)=>{if(entry.pending)set[name]=entry.value;});const remove=[...personalSourceConfiguredEnvNames].filter(name=>!personalSourceEnvironment.has(name));return Object.keys(set).length||remove.length?{set,remove}:undefined;}
    async function personalSaveSource(){try{if(!personalState)await requestPersonalState();if(!personalState)throw new Error(personalText(['Contexto pessoal indisponível.','Personal context unavailable.','Contexto personal no disponible.']));const type=E.personalSourceType.value,label=E.personalSourceLabel.value.trim()||type,existing=personalState.sources.find(s=>s.id===personalSourceEditing),config=personalSourceConfig(),stdioEnv=personalStdioEnvironmentPatch(type);const source={id:existing?existing.id:`source:${type}:${personalReqId()}`,type,label,enabled:E.personalSourceEnabled.checked,endpoint:E.personalSourceEndpoint.value.trim()||undefined,secretRef:E.personalSourceSecret.value.trim()||undefined,config,allowedResources:personalCsv(E.personalSourceResources.value),allowedActions:personalCsv(E.personalSourceActions.value),...(stdioEnv?{stdioEnv}:{})};if(JSON.stringify({config,stdioEnv}).length>32768)throw new Error(t('sourceConfigTooLarge'));await personalRequest({t:'personal_source_put',requestId:personalReqId(),revision:personalState.revision,source});personalResetSource();toast(personalText(['Fonte salva.','Source saved.','Fuente guardada.']));}catch(e){personalError(e);}}
    async function personalTestSource(row,button){const old=button&&button.textContent;if(button){button.disabled=true;button.textContent=t('sourceTesting');}try{const purposes=(row.purposes||[]).filter(p=>personalActiveConsents(row.id).some(c=>c.purposes.includes(p)));if(!purposes.length)throw new Error(personalText(['Autorize ao menos uma finalidade antes do teste.','Authorize at least one purpose before testing.','Autoriza al menos una finalidad antes de probar.']));const result=await personalRequest({t:'personal_source_test',requestId:personalReqId(),sourceId:row.id,purpose:purposes[0],text:E.personalQuery&&E.personalQuery.value.trim()||undefined},30000),count=result.result&&Array.isArray(result.result.items)?result.result.items.length:0;toast(`${t('sourceTestOk')}: ${count} · ${result.status&&Number.isFinite(result.status.latencyMs)?result.status.latencyMs+' ms':'ok'}`);await requestPersonalState();}catch(e){personalError(e);}finally{if(button&&button.isConnected){button.disabled=false;button.textContent=old||t('testSource');}}}
    async function personalDeleteSource(source){if(!await dialog({title:personalText([`Remover a fonte "${source.label}"?`,`Remove source "${source.label}"?`,`¿Eliminar la fuente "${source.label}"?`]),okText:personalText(['Remover','Remove','Eliminar']),danger:true}))return;try{await personalRequest({t:'personal_source_delete',requestId:personalReqId(),revision:personalState.revision,sourceId:source.id});}catch(e){personalError(e);}}
    function personalSelectedValues(select){return Array.from(select&&select.options||[]).filter(o=>o.selected).map(o=>o.value);}
    function personalSetSelectedValues(select,values){const wanted=new Set(values||[]);Array.from(select&&select.options||[]).forEach(o=>{o.selected=wanted.has(o.value);});}
    function personalToggleGeofenceForm(){const enabled=!!E.personalFavoriteGeofence.checked;E.personalFavoriteGeofenceRadius.disabled=!enabled;E.personalFavoriteEnter.disabled=!enabled;E.personalFavoriteExit.disabled=!enabled;}
    function personalResetFavorite(){personalFavoriteEditing='';personalFavoriteSource=null;E.personalFavoriteLabel.value='';E.personalFavoriteAddress.value='';E.personalFavoriteAliases.value='';personalSetSelectedValues(E.personalFavoritePurposes,['nearby','mobility']);E.personalFavoriteLat.value='';E.personalFavoriteLng.value='';E.personalFavoriteGeofence.checked=false;E.personalFavoriteGeofenceRadius.value='200';E.personalFavoriteEnter.checked=true;E.personalFavoriteExit.checked=true;E.personalFavoriteAddressResults.innerHTML='';E.personalFavoriteAddressResults.classList.add('hidden');E.personalFavoriteLocationStatus.textContent='';E.personalFavoriteReset.classList.add('hidden');E.personalFavoriteSave.textContent=t('saveFavorite');personalToggleGeofenceForm();}
    function personalEditFavorite(favorite){personalFavoriteEditing=favorite.id;personalFavoriteSource=favorite.source?{...favorite.source}:null;E.personalFavoriteLabel.value=favorite.label||'';E.personalFavoriteAddress.value=favorite.address||'';E.personalFavoriteAliases.value=(favorite.aliases||[]).join(', ');personalSetSelectedValues(E.personalFavoritePurposes,favorite.purposes||[]);E.personalFavoriteLat.value=favorite.point&&favorite.point.lat;E.personalFavoriteLng.value=favorite.point&&favorite.point.lng;E.personalFavoriteGeofence.checked=!!favorite.geofenceRadiusM;E.personalFavoriteGeofenceRadius.value=favorite.geofenceRadiusM||200;E.personalFavoriteEnter.checked=(favorite.geofenceTransitions||[]).includes('enter');E.personalFavoriteExit.checked=(favorite.geofenceTransitions||[]).includes('exit');E.personalFavoriteAddressResults.innerHTML='';E.personalFavoriteAddressResults.classList.add('hidden');E.personalFavoriteLocationStatus.textContent=favorite.source&&favorite.source.sourceId?`${t('favoriteProvenance')}: ${personalSourceName(favorite.source.sourceId)}`:'';E.personalFavoriteReset.classList.remove('hidden');E.personalFavoriteSave.textContent=t('saveFavorite');personalToggleGeofenceForm();const details=E.personalFavoriteGeofence.closest('details');if(details)details.open=true;E.personalFavoriteLabel.focus();}
    function personalUseFavoriteSuggestion(suggestion){const point=personalSuggestionPoint(suggestion);if(!point)return;personalFavoriteSource=personalSuggestionSource(suggestion);E.personalFavoriteLat.value=point.lat;E.personalFavoriteLng.value=point.lng;const address=personalCandidateAddress(suggestion);if(address)E.personalFavoriteAddress.value=address;if(!E.personalFavoriteLabel.value.trim())E.personalFavoriteLabel.value=String(suggestion.candidate&&suggestion.candidate.title||'').slice(0,100);E.personalFavoriteAddressResults.classList.add('hidden');E.personalFavoriteLocationStatus.textContent=`${t('addressResolved')}: ${String(suggestion.candidate&&suggestion.candidate.title||'')}`;}
    async function personalFindFavoriteAddress(){const query=E.personalFavoriteAddress.value.trim();if(!query){personalError(new Error(t('address')));return;}E.personalFavoriteFindAddress.disabled=true;E.personalFavoriteLocationStatus.textContent=personalText(['Buscando endereço...','Finding address...','Buscando dirección...']);try{const rows=await personalGeocodeCandidates(query);renderPersonalPlaceChoices(E.personalFavoriteAddressResults,rows,{emptyKey:'noAddresses',actionKey:'chooseAddress',onSelect:personalUseFavoriteSuggestion});E.personalFavoriteLocationStatus.textContent=rows.length?personalText(['Escolha um endereço.','Choose an address.','Elige una dirección.']):t('noAddresses');}catch(e){personalError(e);}finally{E.personalFavoriteFindAddress.disabled=false;}}
    async function personalSaveSuggestionAsFavorite(suggestion,purpose){
      const point=personalSuggestionPoint(suggestion);if(!point){personalError(new Error(t('navigationOpenFailed')));return;}const candidate=suggestion.candidate||{},suggested=String(candidate.title||'').slice(0,100),label=await dialog({title:t('favoriteNamePrompt'),input:true,value:suggested,placeholder:t('label'),okText:t('saveAsFavorite')});if(label===null)return;if(!String(label).trim()){personalError(new Error(t('label')));return;}
      try{if(!personalState)await requestPersonalState();const favorite={id:`favorite:${personalReqId()}`,label:String(label).trim().slice(0,100),aliases:[],point,address:personalCandidateAddress(suggestion)||undefined,source:personalSuggestionSource(suggestion)||undefined,purposes:[personalPurposeLabels[purpose]?purpose:'nearby']};await personalRequest({t:'personal_favorite_put',requestId:personalReqId(),revision:personalState.revision,favorite});toast(t('favoriteFromResultSaved'));}catch(e){personalError(e);}
    }
    async function personalSaveFavorite(){if(E.personalFavoriteSave.disabled)return;E.personalFavoriteSave.disabled=true;try{if(!personalState)await requestPersonalState();const latRaw=E.personalFavoriteLat.value.trim(),lngRaw=E.personalFavoriteLng.value.trim(),lat=Number(latRaw),lng=Number(lngRaw),label=E.personalFavoriteLabel.value.trim(),purposes=personalSelectedValues(E.personalFavoritePurposes),existing=(personalState.favorites||[]).find(f=>f.id===personalFavoriteEditing),monitor=E.personalFavoriteGeofence.checked;if(!label||!latRaw||!lngRaw||!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lng)||lng<-180||lng>180)throw new Error(personalText(['Informe um nome e resolva o endereço ou a localização.','Provide a name and resolve the address or location.','Indica un nombre y resuelve la dirección o ubicación.']));if(!purposes.length)throw new Error(personalText(['Selecione ao menos uma finalidade.','Select at least one purpose.','Selecciona al menos una finalidad.']));const favorite={id:existing?existing.id:`favorite:${personalReqId()}`,label,aliases:personalCsv(E.personalFavoriteAliases.value),point:{lat,lng},address:E.personalFavoriteAddress.value.trim()||undefined,purposes,...(personalFavoriteSource?{source:{...personalFavoriteSource}}:existing&&existing.source?{source:existing.source}:{})};if(monitor){const radius=Number(E.personalFavoriteGeofenceRadius.value),transitions=[E.personalFavoriteEnter.checked?'enter':'',E.personalFavoriteExit.checked?'exit':''].filter(Boolean);if(!Number.isFinite(radius)||radius<50||radius>10000)throw new Error(personalText(['O raio deve ficar entre 50 e 10.000 metros.','Radius must be between 50 and 10,000 meters.','El radio debe estar entre 50 y 10.000 metros.']));if(!transitions.length)throw new Error(personalText(['Escolha chegada e/ou saída.','Choose arrival and/or departure.','Elige llegada y/o salida.']));favorite.geofenceRadiusM=Math.round(radius);favorite.geofenceTransitions=transitions;}await personalRequest({t:'personal_favorite_put',requestId:personalReqId(),revision:personalState.revision,favorite});personalResetFavorite();await syncPersonalGeofences({grantConsent:monitor});toast(t('favoriteSaved'));}catch(e){personalError(e);}finally{E.personalFavoriteSave.disabled=false;}}
    async function personalDeleteFavorite(id){try{await personalRequest({t:'personal_favorite_delete',requestId:personalReqId(),revision:personalState.revision,favoriteId:id});if(personalFavoriteEditing===id)personalResetFavorite();await syncPersonalGeofences();}catch(e){personalError(e);}}
    function personalOptionalPositive(input,label,maximum){const raw=input.value.trim();if(!raw)return undefined;const value=Number(raw);if(!Number.isFinite(value)||value<=0||value>maximum)throw new Error(label);return value;}
    function personalResetVehicle(){personalVehicleEditing='';E.personalVehicleId.value='';E.personalVehicleLabel.value='';E.personalVehicleConnectors.value='';E.personalVehicleMaxPower.value='';E.personalVehicleRange.value='';E.personalVehicleMinPower.value='';E.personalVehicleOperators.value='';E.personalVehicleDefault.checked=false;E.personalVehicleSave.textContent=t('saveVehicle');}
    function personalEditVehicle(profile){personalVehicleEditing=profile.id;E.personalVehicleId.value=profile.id;E.personalVehicleLabel.value=profile.label||'';E.personalVehicleConnectors.value=(profile.connectorTypeIds||[]).join(', ');E.personalVehicleMaxPower.value=profile.maxAcceptedPowerKw||'';E.personalVehicleRange.value=profile.rangeKm||'';E.personalVehicleMinPower.value=profile.minimumPreferredPowerKw||'';E.personalVehicleOperators.value=(profile.preferredOperators||[]).join(', ');E.personalVehicleDefault.checked=!!profile.isDefault;E.personalVehicleForm.open=true;E.personalVehicleLabel.focus();}
    async function personalSaveVehicle(){try{if(!personalState)await requestPersonalState();const id=E.personalVehicleId.value.trim(),label=E.personalVehicleLabel.value.trim(),connectorTypeIds=[...new Set(personalCsv(E.personalVehicleConnectors.value).map(Number))],preferredOperators=personalCsv(E.personalVehicleOperators.value);if(!id||!label)throw new Error(personalText(['Informe ID e nome do veículo.','Provide vehicle ID and name.','Indica ID y nombre del vehículo.']));if(!connectorTypeIds.length||connectorTypeIds.length>20||connectorTypeIds.some(n=>!Number.isSafeInteger(n)||n<=0))throw new Error(personalText(['Informe de 1 a 20 IDs OCM numéricos válidos.','Provide 1 to 20 valid numeric OCM IDs.','Indica de 1 a 20 IDs OCM numéricos válidos.']));if(preferredOperators.length>20||preferredOperators.some(value=>value.length>100))throw new Error(personalText(['Informe no máximo 20 operadores de até 100 caracteres.','Provide at most 20 operators up to 100 characters each.','Indica como máximo 20 operadores de hasta 100 caracteres.']));const profile={id,label,connectorTypeIds,preferredOperators,isDefault:E.personalVehicleDefault.checked},max=personalOptionalPositive(E.personalVehicleMaxPower,personalText(['A potência máxima deve ficar entre 0 e 1.000 kW.','Maximum power must be between 0 and 1,000 kW.','La potencia máxima debe estar entre 0 y 1.000 kW.']),1000),range=personalOptionalPositive(E.personalVehicleRange,personalText(['A autonomia deve ficar entre 0 e 5.000 km.','Range must be between 0 and 5,000 km.','La autonomía debe estar entre 0 y 5.000 km.']),5000),min=personalOptionalPositive(E.personalVehicleMinPower,personalText(['A potência mínima deve ficar entre 0 e 1.000 kW.','Minimum power must be between 0 and 1,000 kW.','La potencia mínima debe estar entre 0 y 1.000 kW.']),1000);if(max!==undefined)profile.maxAcceptedPowerKw=max;if(range!==undefined)profile.rangeKm=range;if(min!==undefined)profile.minimumPreferredPowerKw=min;if(max!==undefined&&min!==undefined&&min>max)throw new Error(personalText(['A potência mínima preferida não pode superar a potência aceita.','Preferred minimum power cannot exceed accepted power.','La potencia mínima preferida no puede superar la potencia aceptada.']));const oldId=personalVehicleEditing;await personalRequest({t:'personal_vehicle_put',requestId:personalReqId(),revision:personalState.revision,profile});if(oldId&&oldId!==id)await personalRequest({t:'personal_vehicle_delete',requestId:personalReqId(),revision:personalState.revision,profileId:oldId});personalResetVehicle();toast(t('vehicleSaved'));}catch(e){personalError(e);}}
    async function personalDeleteVehicle(profile){if(!await dialog({title:personalText([`Remover o veículo "${profile.label}"?`,`Remove vehicle "${profile.label}"?`,`¿Eliminar el vehículo "${profile.label}"?`]),okText:t('remove'),danger:true}))return;try{await personalRequest({t:'personal_vehicle_delete',requestId:personalReqId(),revision:personalState.revision,profileId:profile.id});if(personalVehicleEditing===profile.id)personalResetVehicle();}catch(e){personalError(e);}}
    function personalResetPreference(){personalPreferenceEditing='';personalPreferenceCorrectionId='';E.personalPreferenceKey.value='';E.personalPreferenceValue.value='';E.personalPreferencePolarity.value='prefer';personalSetSelectedValues(E.personalPreferencePurpose,['nearby']);E.personalPreferenceExpires.value='';E.personalPreferenceExpires.disabled=false;E.personalPreferenceSave.textContent=t('savePreference');E.personalPreferenceSave.dataset.i18n='savePreference';E.personalPreferenceReset.classList.add('hidden');E.personalPreferenceEditorNote.classList.add('hidden');E.personalPreferenceEditorNote.textContent='';}
    function personalPopulatePreferenceEditor(preference){E.personalPreferenceKey.value=preference.key||'';E.personalPreferenceValue.value=preference.value||'';E.personalPreferencePolarity.value=preference.polarity||'prefer';personalSetSelectedValues(E.personalPreferencePurpose,preference.purposes&&preference.purposes.length?preference.purposes:['nearby']);E.personalPreferenceExpires.value=preference.expiresAt?personalDateTimeLocal(preference.expiresAt):'';E.personalPreferenceReset.classList.remove('hidden');E.personalPreferenceKey.focus();E.personalPreferenceEditorNote.closest('.personal-form')?.scrollIntoView({block:'nearest'});}
    function personalEditPreference(preference){personalPreferenceEditing=preference.id;personalPreferenceCorrectionId='';E.personalPreferenceExpires.disabled=false;E.personalPreferenceSave.textContent=t('savePreference');E.personalPreferenceSave.dataset.i18n='savePreference';E.personalPreferenceEditorNote.classList.add('hidden');E.personalPreferenceEditorNote.textContent='';personalPopulatePreferenceEditor(preference);}
    function personalCorrectPreference(preference){personalPreferenceEditing='';personalPreferenceCorrectionId=preference.id;E.personalPreferenceExpires.disabled=true;E.personalPreferenceSave.textContent=t('saveCorrection');E.personalPreferenceSave.dataset.i18n='saveCorrection';E.personalPreferenceEditorNote.textContent=t('correctPreferenceNote');E.personalPreferenceEditorNote.classList.remove('hidden');personalPopulatePreferenceEditor(preference);}
    async function personalDecidePreference(preference,decision){if(!preference||!['confirm','reject'].includes(decision)||personalPreferenceDecisionsPending.has(preference.id))return;if(decision==='reject'){const confirmed=await dialog({title:[t('rejectPreferenceTitle'),t('rejectPreferenceBody')].join('\n\n'),okText:t('rejectPreference'),danger:true});if(!confirmed)return;}personalPreferenceDecisionsPending.add(preference.id);try{if(!personalState)await requestPersonalState();await personalRequest({t:'personal_preference_decision',requestId:personalReqId(),revision:personalState.revision,preferenceId:preference.id,decision});if(personalPreferenceCorrectionId===preference.id||personalPreferenceEditing===preference.id)personalResetPreference();toast(t(decision==='confirm'?'preferenceConfirmed':'preferenceRejected'));}catch(e){personalError(e);}finally{personalPreferenceDecisionsPending.delete(preference.id);}}
    async function personalSavePreference(){if(E.personalPreferenceSave.disabled)return;E.personalPreferenceSave.disabled=true;try{const key=E.personalPreferenceKey.value.trim(),value=E.personalPreferenceValue.value.trim(),purposes=personalSelectedValues(E.personalPreferencePurpose),expiresRaw=E.personalPreferenceExpires.value,expiresAt=expiresRaw?new Date(expiresRaw).getTime():undefined;if(!key||!value)throw new Error(personalText(['Informe categoria e preferência.','Provide category and preference.','Indica categoría y preferencia.']));if(!purposes.length)throw new Error(t('preferencePurposesRequired'));if(expiresAt!==undefined&&(!Number.isFinite(expiresAt)||expiresAt<=Date.now()))throw new Error(t('memoryExpiryFuture'));if(!personalState)await requestPersonalState();if(personalPreferenceCorrectionId){await personalRequest({t:'personal_preference_decision',requestId:personalReqId(),revision:personalState.revision,preferenceId:personalPreferenceCorrectionId,decision:'correct',correction:{key,value,polarity:E.personalPreferencePolarity.value,purposes}});toast(t('preferenceCorrected'));}else{const now=Date.now(),existing=(personalState.preferences||[]).find(p=>p.id===personalPreferenceEditing);await personalRequest({t:'personal_preference_put',requestId:personalReqId(),revision:personalState.revision,preference:{id:existing?existing.id:`preference:${personalReqId()}`,key,value,polarity:E.personalPreferencePolarity.value,confidence:1,evidence:[...(existing&&existing.evidence||[]),{id:`statement:${personalReqId()}`,kind:existing?'correction':'statement',at:now,summary:value}],purposes,...(expiresAt===undefined?{}:{expiresAt})}});}personalResetPreference();}catch(e){personalError(e);}finally{E.personalPreferenceSave.disabled=false;}}
    async function personalDeletePreference(preference){if(!preference||!await dialog({title:[t('forgetPreferenceTitle'),t('forgetPreferenceBody')].join('\n\n'),okText:t('forget'),danger:true}))return;try{await personalRequest({t:'personal_preference_delete',requestId:personalReqId(),revision:personalState.revision,preferenceId:preference.id});if(personalPreferenceEditing===preference.id||personalPreferenceCorrectionId===preference.id)personalResetPreference();toast(t('memoryForgotten'));}catch(e){personalError(e);}}
    function downloadPersonalExport(data){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='jarvis-personal-context-'+new Date().toISOString().slice(0,10)+'.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    const personalCategoryKeys={observations:'categoryObservations',preferences:'categoryPreferences',favorites:'categoryFavorites',vehicle_profiles:'categoryVehicleProfiles',actions:'categoryActions',notifications:'categoryNotifications',sources:'categorySources',consents:'categoryConsents',device_profiles:'categoryDeviceProfiles'};
    const personalCategoryEffectKeys={observations:'categoryEffectObservations',preferences:'categoryEffectPreferences',favorites:'categoryEffectFavorites',vehicle_profiles:'categoryEffectVehicleProfiles',actions:'categoryEffectActions',notifications:'categoryEffectNotifications',sources:'categoryEffectSources',consents:'categoryEffectConsents',device_profiles:'categoryEffectDeviceProfiles'};
    async function discardPersonalNativeObservations(){await erasePersonalNativeContext();if(personalState&&personalState.settings.locationMode==='background')await syncPersonalGeofences();}
    async function personalEraseSelectedCategory(){const category=E.personalEraseCategory&&E.personalEraseCategory.value,label=t(personalCategoryKeys[category]||category),effect=t(personalCategoryEffectKeys[category]||'categoryEraseIrreversible');if(!personalCategoryKeys[category])return;const confirmed=await dialog({title:[t('categoryEraseConfirm'),label,effect,t('categoryEraseIrreversible')].join('\n\n'),okText:t('eraseSelected'),danger:true});if(!confirmed)return;E.personalEraseCategoryButton.disabled=true;try{if(!personalState)await requestPersonalState();await personalRequest({t:'personal_data_category_erase',requestId:personalReqId(),revision:personalState.revision,category,confirmation:'ERASE_CATEGORY'});if(category==='favorites'){personalResetFavorite();await erasePersonalNativeContext();}else if(category==='observations')await discardPersonalNativeObservations();else if(category==='consents')await erasePersonalNativeContext();else if(category==='device_profiles'){await erasePersonalNativeContext();try{localStorage.removeItem(personalDeviceMarkerKey());}catch(e){}renderPersonalDeviceProfile();}else if(category==='vehicle_profiles')personalResetVehicle();else if(category==='preferences')personalResetPreference();else if(category==='sources')personalResetSource();else if(category==='actions'&&!E.personalActionModal.classList.contains('hidden'))closePersonalAction();else if(category==='notifications'){personalProactiveNotifications.clear();clearPersonalOpenedFeedback();document.querySelectorAll('.personal-notification-toast').forEach(el=>el.remove());}toast(t('categoryEraseDone'));}catch(e){personalError(e);}finally{E.personalEraseCategoryButton.disabled=false;}}
    function personalDeepLinkId(value){value=String(value||'');return value&&value.length<=200&&!/[\u0000-\u001f\u007f]/.test(value)?value:'';}
    function personalDeepLinkTarget(link){try{
      const raw=String(link||location.href);if(!raw||raw.length>2048||/[\u0000-\u001f\u007f\\]/.test(raw))return null;
      const source=new URL(raw,location.href);let query='',target;
      const sameOrigin=source.origin!=='null'?source.origin===location.origin:!!source.host&&source.protocol===location.protocol&&source.host===location.host;
      if(source.protocol==='jarvis:'){
        if(source.username||source.password||source.hostname.toLowerCase()!=='assistant')return null;
        const path=source.pathname.replace(/^\/+|\/+$/g,'');if(path&&path!=='personal-assistant')return null;
        if(source.hash){const match=/^personal-assistant(?:\?([^#]*))?$/.exec(source.hash.slice(1));if(!match)return null;query=match[1]||'';}else query=source.search.slice(1);
        target=new URL(location.href);target.hash='personal-assistant'+(query?'?'+query:'');
      }else if(sameOrigin){
        if(source.username||source.password)return null;
        const match=/^personal-assistant(?:\?([^#]*))?$/.exec(source.hash.slice(1));if(!match)return null;
        query=match[1]||'';target=new URL(source.href);
      }else return null;
      const params=new URLSearchParams(query),rawSuggestion=params.get('suggestion'),rawNotification=params.get('notification');
      const suggestionId=personalDeepLinkId(rawSuggestion),notificationId=personalDeepLinkId(rawNotification);
      if((rawSuggestion!==null&&!suggestionId)||(rawNotification!==null&&!notificationId))return null;
      return{href:target.href,suggestionId,notificationId};
    }catch(e){return null;}}
    function personalOpenedFeedbackKey(){return'jarvis_personal_opened_notifications:'+String(authUser&&authUser.id||'local').slice(0,100);}
    function loadPersonalOpenedFeedback(){const scope=personalOpenedFeedbackKey();if(scope===personalOpenedFeedbackScope)return;personalOpenedFeedbackScope=scope;personalOpenedFeedbackIds=new Set();try{const rows=JSON.parse(localStorage.getItem(scope)||'[]');if(Array.isArray(rows))rows.slice(-500).forEach(id=>{id=personalDeepLinkId(id);if(id)personalOpenedFeedbackIds.add(id);});}catch(e){}}
    function claimPersonalOpenedFeedback(id){id=personalDeepLinkId(id);if(!id)return false;loadPersonalOpenedFeedback();if(personalOpenedFeedbackIds.has(id))return false;personalOpenedFeedbackIds.add(id);while(personalOpenedFeedbackIds.size>500)personalOpenedFeedbackIds.delete(personalOpenedFeedbackIds.values().next().value);try{localStorage.setItem(personalOpenedFeedbackScope,JSON.stringify([...personalOpenedFeedbackIds]));}catch(e){}return true;}
    function clearPersonalOpenedFeedback(){const scope=personalOpenedFeedbackKey();try{localStorage.removeItem(scope);}catch(e){}if(personalOpenedFeedbackScope===scope)personalOpenedFeedbackIds.clear();}
    function personalNotificationRecord(id){return(personalState&&Array.isArray(personalState.notifications)?personalState.notifications:[]).find(row=>row&&String(row.id)===id)||null;}
    async function loadPersonalNotificationRecord(id){const record=personalNotificationRecord(id);if(record)return record;await personalRequest({t:'personal_context_get',requestId:personalReqId()});return personalNotificationRecord(id);}
    function showPersonalProactiveResult(notification,suggestionId){openPersonalModal();const suggestion=personalSuggestionById(suggestionId);if(suggestion){renderPersonalSuggestions([suggestion],[],E.personalPurpose.value);E.personalQueryStatus.textContent=t('proactiveLoaded');}else{E.personalResults.innerHTML='';renderPersonalDiagnostics([]);const card=document.createElement('div');card.className='personal-result';const title=document.createElement('b');title.textContent=notification&&notification.title||t('personalSuggestionsAvailable');const body=document.createElement('div');body.className='personal-reasons';body.textContent=notification&&notification.body||t('proactiveUnavailable');card.append(title,body);E.personalResults.appendChild(card);E.personalQueryStatus.textContent=t('proactiveUnavailable');}if(notification&&notification.id)appendPersonalNotificationDetail(E.personalResults,notification);setPersonalView('list');}
    async function openPersonalDeepLink(link,notification){const target=personalDeepLinkTarget(link);if(!target)return false;if(!authed){pendingPersonalDeepLink=target.href;return true;}history.replaceState(null,'',new URL(target.href).pathname+new URL(target.href).search+new URL(target.href).hash);let record=notification&&notification.id?notification:null;const notificationId=target.notificationId||personalDeepLinkId(record&&record.id);if(notificationId&&(!record||String(record.id)!==notificationId)){try{record=await loadPersonalNotificationRecord(notificationId);}catch(e){personalError(e);}}if(record)rememberPersonalProactiveNotification(record);const suggestionId=target.suggestionId||record&&record.suggestionId||'';showPersonalProactiveResult(record||personalProactiveNotifications.get(notificationId)||personalProactiveNotifications.get(suggestionId),suggestionId);if(notificationId&&record)await personalNotificationFeedback(record,'opened');return true;}
    function queuePersonalDeepLink(link){const target=personalDeepLinkTarget(link);if(!target)return false;const now=Date.now();if(target.href===lastPersonalDeepLink&&now-lastPersonalDeepLinkAt<2000)return true;lastPersonalDeepLink=target.href;lastPersonalDeepLinkAt=now;if(!authed){pendingPersonalDeepLink=target.href;return true;}openPersonalDeepLink(target.href).catch(personalError);return true;}
    function consumePendingPersonalDeepLink(){if(!pendingPersonalDeepLink)return false;const link=pendingPersonalDeepLink;pendingPersonalDeepLink='';openPersonalDeepLink(link).catch(personalError);return true;}
    function rememberPersonalProactiveNotification(notification){for(const key of [notification.id,notification.suggestionId].filter(Boolean)){personalProactiveNotifications.delete(key);personalProactiveNotifications.set(key,notification);}while(personalProactiveNotifications.size>200)personalProactiveNotifications.delete(personalProactiveNotifications.keys().next().value);}
    function forgetPersonalProactiveNotification(notification){for(const key of [notification&&notification.id,notification&&notification.suggestionId].filter(Boolean))personalProactiveNotifications.delete(key);}
    function personalNotificationFeedbackOutcomes(notification){const capabilities=personalState&&personalState.capabilities||{},feedback=capabilities.notificationFeedback||{},advertised=[notification&&notification.feedbackOutcomes,notification&&notification.allowedFeedbackOutcomes,personalState&&personalState.notificationFeedbackOutcomes,capabilities.notificationFeedbackOutcomes,feedback.outcomes].find(Array.isArray),defaults=['opened','dismissed','acted','ignored'];return new Set([...defaults,...(advertised||[])].map(String).filter(value=>['opened','dismissed','acted','ignored'].includes(value)));}
    function personalNotificationSupportsOutcome(notification,outcome){return personalNotificationFeedbackOutcomes(notification).has(outcome);}
    async function personalNotificationFeedback(notification,outcome,disableKind=false){if(!notification||!notification.id)throw new Error(personalText(['Notificação indisponível.','Notification unavailable.','Notificación no disponible.']));if(!personalNotificationSupportsOutcome(notification,outcome))throw new Error(t('feedbackOutcomeUnavailable'));const id=String(notification.id),previous=personalNotificationFeedbackQueues.get(id)||Promise.resolve(),task=previous.catch(()=>{}).then(async()=>{if(outcome==='opened'&&!claimPersonalOpenedFeedback(id))return false;await personalRequest({t:'personal_notification_feedback',requestId:personalReqId(),notificationId:notification.id,outcome,...(disableKind?{disableKind:true}:{})});if(disableKind)await personalRequest({t:'personal_context_get',requestId:personalReqId()});return true;});personalNotificationFeedbackQueues.set(id,task);try{return await task;}finally{if(personalNotificationFeedbackQueues.get(id)===task)personalNotificationFeedbackQueues.delete(id);}}
    function appendPersonalNotificationKindNote(parent,notification){if(notification&&notification.kind==='weather_risk_estimate'){const note=document.createElement('span');note.className='personal-note';note.textContent=t('weatherRiskEstimateNote');parent.appendChild(note);}}
    function appendPersonalNotificationFeedbackActions(parent,notification,onDone){const buttons=[],finish=typeof onDone==='function'?onDone:()=>{};const run=async(outcome,disableKind=false)=>{buttons.forEach(button=>button.disabled=true);try{await personalNotificationFeedback(notification,outcome,disableKind);forgetPersonalProactiveNotification(notification);if(disableKind)renderPersonalDeviceProfile();finish(outcome,disableKind);}catch(e){personalError(e);buttons.forEach(button=>button.disabled=false);}};if(personalNotificationSupportsOutcome(notification,'ignored')){const ignore=personalButton(t('notificationIgnore'),()=>run('ignored'));ignore.setAttribute('aria-label',t('notificationIgnore'));buttons.push(ignore);parent.appendChild(ignore);}const dismiss=personalButton(t('notificationDismiss'),()=>run('dismissed'));dismiss.setAttribute('aria-label',t('notificationDismiss'));buttons.push(dismiss);parent.appendChild(dismiss);if(notification.kind){const kindLabel=personalProactiveKindLabel(notification.kind),disable=personalButton(t('notificationDisableKind'),async()=>{const confirmed=await dialog({title:[t('notificationDisableConfirm'),`${t('notificationKind')}: ${kindLabel}`].join('\n\n'),okText:t('notificationDisableKind'),danger:true});if(confirmed)run('acted',true);});disable.setAttribute('aria-label',`${t('notificationDisableKind')}: ${kindLabel}`);buttons.push(disable);parent.appendChild(disable);}}
    function appendPersonalNotificationDetail(parent,notification){const detail=document.createElement('div');detail.className='personal-result';appendPersonalNotificationKindNote(detail,notification);const actions=document.createElement('div');actions.className='personal-inline-actions';appendPersonalNotificationFeedbackActions(actions,notification,(outcome,disableKind)=>{const status=document.createElement('span');status.className='personal-note';status.setAttribute('role','status');status.textContent=t(disableKind?'notificationKindDisabled':outcome==='ignored'?'notificationIgnored':'notificationDismissed');actions.replaceChildren(status);});detail.appendChild(actions);parent.appendChild(detail);}
    function showPersonalProactiveToast(notification){const box=document.createElement('div');box.className='toast personal-notification-toast';box.setAttribute('role','region');box.setAttribute('aria-label',t('proactiveNotificationLabel'));const copy=document.createElement('div');copy.className='personal-notification-copy';const title=document.createElement('b'),body=document.createElement('span');title.textContent=notification.title||t('personalSuggestionsAvailable');body.textContent=notification.body||t('personalSuggestionsAvailable');copy.append(title,body);appendPersonalNotificationKindNote(copy,notification);const actions=document.createElement('div');actions.className='personal-notification-actions';const close=()=>{if(box.parentNode)box.remove();};const open=personalButton(t('notificationOpen'),()=>{close();openPersonalDeepLink(notification.deepLink||`/#personal-assistant?suggestion=${encodeURIComponent(notification.suggestionId||'')}&notification=${encodeURIComponent(notification.id||'')}`,notification).catch(personalError);});open.setAttribute('aria-label',t('notificationOpen'));actions.appendChild(open);appendPersonalNotificationFeedbackActions(actions,notification,close);box.append(copy,actions);document.body.appendChild(box);setTimeout(close,20000);}
    function handlePersonalProactiveNotification(frame){const notification=frame.notification||{},expiresAt=Number(notification.expiresAt);if(Number.isFinite(expiresAt)&&expiresAt<=Date.now())return;rememberPersonalProactiveNotification(notification);showPersonalProactiveToast(notification);}
    function clearPersonalNativeData(){writePersonalTransitionQueue([]);personalNativeTransitionCount=0;personalNativeGeofenceConfigured=false;personalLocationReadyUntil=0;renderPersonalNativeStatus();renderPersonalReferenceOptions();}
    async function personalEraseEverything(){if(!await dialog({title:personalText(['Apagar permanentemente todo contexto pessoal, consentimentos, favoritos, veículos e histórico de ações?','Permanently erase all personal context, consent, favorites, vehicles and action history?','¿Borrar permanentemente todo el contexto personal, consentimientos, favoritos, vehículos e historial de acciones?']),okText:personalText(['Apagar tudo','Erase all','Borrar todo']),danger:true}))return;try{await erasePersonalNativeContext();await personalRequest({t:'personal_data_erase',requestId:personalReqId(),confirmation:'ERASE'});}catch(e){personalError(e);}}
    function handlePersonalFrame(m){if(!m||typeof m.t!=='string'||!m.t.startsWith('personal_'))return false;if(m.t==='personal_turn_suggestions')handlePersonalTurnSuggestions(m);else if(m.t==='personal_proactive_notification')handlePersonalProactiveNotification(m);else if(m.t==='personal_context_state'){personalState=m.state;renderPersonalState();personalSettle(m);}else if(m.t==='personal_context_result'){if(m.conflict){personalState=m.conflict;renderPersonalState();}else if(m.ok&&personalState&&Number.isSafeInteger(m.revision))personalState.revision=m.revision;if(m.ok)personalSettle(m);else{const error=new Error(m.error||'personal context error');personalSettle(m,error);}}else if(m.t==='personal_context_suggestions'){if(personalState&&Number.isSafeInteger(m.revision))personalState.revision=m.revision;if(!personalSilentSuggestionRequests.has(m.requestId))renderPersonalSuggestions(m.suggestions,m.errors,undefined,m.diagnostics,m.regionSuggestion);personalSettle(m);}else if(m.t==='personal_source_discovery'||m.t==='personal_source_test_result'||m.t==='personal_action_view'){personalSettle(m);}else if(m.t==='personal_data_export'){downloadPersonalExport(m.data);personalSettle(m);}else if(m.t==='personal_data_erased'){personalSettle(m);personalState=null;try{localStorage.removeItem(personalDeviceMarkerKey());}catch(e){}clearPersonalOpenedFeedback();clearPersonalNativeData();requestPersonalState();}return true;}
    if(E.personalBtn)E.personalBtn.onclick=openPersonalModal;if(E.personalOpenQuery)E.personalOpenQuery.onclick=openPersonalModal;if(E.personalClose)E.personalClose.onclick=closePersonalModal;if(E.personalRun)E.personalRun.onclick=runPersonalQuery;if(E.personalQuery)E.personalQuery.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();runPersonalQuery();}};if(E.personalPurpose)E.personalPurpose.onchange=renderPersonalReferenceOptions;if(E.personalLocate)E.personalLocate.onclick=async()=>{try{await putPersonalLocation(E.personalPurpose.value);E.personalReference.value='auto';renderPersonalReferenceOptions();E.personalQueryStatus.textContent=personalText(['Localização pronta para esta consulta.','Location ready for this query.','Ubicación lista para esta consulta.']);}catch(e){personalError(e);}};if(E.personalSettingsLocate)E.personalSettingsLocate.onclick=async()=>{try{await putPersonalLocation('nearby',true);if(E.personalLocationMode.value==='background')await syncPersonalGeofences({requestBackground:true});}catch(e){personalError(e);}};if(E.personalReference)E.personalReference.onchange=personalReferenceUi;if(E.personalRegionResolve)E.personalRegionResolve.onclick=resolvePersonalRegion;if(E.personalRegion)E.personalRegion.oninput=()=>{personalResolvedRegion=null;E.personalRegionResults.classList.add('hidden');};if(E.personalRegion)E.personalRegion.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();resolvePersonalRegion();}};if(E.personalViewList)E.personalViewList.onclick=()=>setPersonalView('list');if(E.personalViewMap)E.personalViewMap.onclick=()=>setPersonalView('map');if(E.personalCalendarEditClose)E.personalCalendarEditClose.onclick=()=>closePersonalCalendarEdit();if(E.personalCalendarEditCancel)E.personalCalendarEditCancel.onclick=()=>closePersonalCalendarEdit();if(E.personalCalendarEditPreview)E.personalCalendarEditPreview.onclick=previewPersonalCalendarEdit;if(E.personalActionClose)E.personalActionClose.onclick=closePersonalAction;if(E.personalActionCancel)E.personalActionCancel.onclick=()=>E.personalActionCancel.dataset.personalCommand==='close'?closePersonalAction():personalActionCommand('cancel');if(E.personalActionApprove)E.personalActionApprove.onclick=()=>personalActionCommand('approve');if(E.personalActionExecute)E.personalActionExecute.onclick=personalExecuteActionFromClick;
    // Contexto pessoal no chat depende de uma permissão SEPARADA na política adaptativa
    // (allowPersonalContext, owner-only, off por padrão) — ligar o assistente não a liga. Em vez de o
    // usuário ver "personal context is blocked by policy" sem saber onde resolver, ligamos o assistente
    // e (a) ao habilitar, perguntamos se quer permitir e já ligamos; (b) enquanto estiver bloqueado,
    // mostramos um alerta clicável que reoferece. Tudo owner-only (só o dono gerencia a política).
    function personalContextPolicyBlocked(){ return !!adaptivePolicyDoc && !(adaptivePolicyDoc.global&&adaptivePolicyDoc.global.memory&&adaptivePolicyDoc.global.memory.allowPersonalContext===true); }
    function renderPersonalContextPolicyAlert(){ if(!E.personalContextPolicyAlert)return; const owner=!!(authUser&&authUser.role==='owner'), enabled=!!(personalState&&personalState.settings&&personalState.settings.enabled); E.personalContextPolicyAlert.classList.toggle('hidden', !(owner&&enabled&&personalContextPolicyBlocked())); }
    function personalEnableContextPolicy(){ if(!(authUser&&authUser.role==='owner')||!adaptivePolicyDoc)return false; const doc=JSON.parse(JSON.stringify(adaptivePolicyDoc)); doc.global=doc.global||{}; doc.global.memory=Object.assign({},doc.global.memory||{},{allowPersonalContext:true}); doc.global.updatedAt=Date.now(); adaptivePolicyDoc=doc; tx({t:'set_adaptive_policy',doc,sessionId:currentSession}); return true; }
    async function offerPersonalContextPolicy(){ if(!(authUser&&authUser.role==='owner')||!personalContextPolicyBlocked())return; const ok=await dialog({title:t('personalContextPolicyTitle')+'\n\n'+t('personalContextPolicyBody'),okText:t('personalContextPolicyEnable'),cancelText:t('cancel')}); if(ok&&personalEnableContextPolicy())toast(t('personalContextPolicyEnabledToast')); renderPersonalContextPolicyAlert(); }
    if(E.personalContextPolicyAlert){ E.personalContextPolicyAlert.onclick=offerPersonalContextPolicy; E.personalContextPolicyAlert.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); offerPersonalContextPolicy(); } }; }
    if(E.personalSave)E.personalSave.onclick=async()=>{E.personalSave.disabled=true;const wasEnabled=!!(personalState&&personalState.settings&&personalState.settings.enabled);try{const notifications=personalDeviceNotificationPolicyFromControls();await personalUpdateSettings({enabled:E.personalEnabled.checked,paused:E.personalPaused.checked,locationMode:E.personalLocationMode.value,locationPrecision:E.personalPrecision.value});await personalPutCurrentDeviceProfile({proactiveEnabled:E.personalProactiveEnabled.checked,notifications});renderPersonalDeviceProfile();await syncPersonalGeofences();toast(personalText(['Assistente e preferência deste aparelho salvos.','Assistant and this device preference saved.','Asistente y preferencia de este dispositivo guardados.']));if(E.personalEnabled.checked&&!wasEnabled&&personalContextPolicyBlocked())await offerPersonalContextPolicy();else renderPersonalContextPolicyAlert();}catch(e){personalError(e);}finally{E.personalSave.disabled=false;}};
    if(E.personalRetentionSave)E.personalRetentionSave.onclick=async()=>{try{await personalUpdateSettings({retention:{observationsDays:+E.personalObservationsDays.value,decisionsDays:+E.personalDecisionsDays.value,inferredPreferencesDays:+E.personalInferencesDays.value,keepRawLocation:E.personalKeepRawLocation.checked}});toast(personalText(['Retenção salva.','Retention saved.','Retención guardada.']));}catch(e){personalError(e);}};
    if(E.personalSourceType)E.personalSourceType.onchange=()=>{personalClearSourceDiscovery();personalSourceTypeUi();};
    if(E.personalSourceAccess)E.personalSourceAccess.onchange=personalSourceTypeUi;
    if(E.personalSourceEnvAdd)E.personalSourceEnvAdd.onclick=personalAddSourceEnvironment;
    if(E.personalSourceEnvName)E.personalSourceEnvName.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();E.personalSourceEnvValue.focus();}};
    if(E.personalSourceEnvValue)E.personalSourceEnvValue.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();personalAddSourceEnvironment();}};
    if(E.personalSourceSave)E.personalSourceSave.onclick=personalSaveSource;
    if(E.personalSourceReset)E.personalSourceReset.onclick=personalResetSource;
    if(E.personalFavoriteSave)E.personalFavoriteSave.onclick=personalSaveFavorite;
    if(E.personalFavoriteReset)E.personalFavoriteReset.onclick=personalResetFavorite;
    if(E.personalFavoriteGeofence)E.personalFavoriteGeofence.onchange=personalToggleGeofenceForm;
    if(E.personalFavoriteFindAddress)E.personalFavoriteFindAddress.onclick=personalFindFavoriteAddress;
    if(E.personalFavoriteAddress)E.personalFavoriteAddress.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();personalFindFavoriteAddress();}};
    if(E.personalFavoriteAddress)E.personalFavoriteAddress.oninput=()=>{personalFavoriteSource=null;E.personalFavoriteAddressResults.classList.add('hidden');E.personalFavoriteLocationStatus.textContent='';};
    [E.personalFavoriteLat,E.personalFavoriteLng].filter(Boolean).forEach(input=>input.oninput=()=>{personalFavoriteSource=null;E.personalFavoriteLocationStatus.textContent='';});
    if(E.personalFavoriteLocate)E.personalFavoriteLocate.onclick=async()=>{try{const observation=await capturePersonalLocation(),point=observation.point;personalFavoriteSource={sourceId:'device-location',observedAt:observation.observedAt||Date.now(),freshness:'live'};E.personalFavoriteLat.value=point.lat;E.personalFavoriteLng.value=point.lng;E.personalFavoriteLocationStatus.textContent=personalText(['Localização do aparelho selecionada.','Device location selected.','Ubicación del dispositivo seleccionada.']);}catch(e){personalError(e);}};
    if(E.personalVehicleSave)E.personalVehicleSave.onclick=personalSaveVehicle;
    if(E.personalVehicleReset)E.personalVehicleReset.onclick=personalResetVehicle;
    if(E.personalPreferenceSave)E.personalPreferenceSave.onclick=personalSavePreference;
    if(E.personalPreferenceReset)E.personalPreferenceReset.onclick=personalResetPreference;
    if(E.personalExport)E.personalExport.onclick=()=>personalRequest({t:'personal_data_export',requestId:personalReqId()}).catch(personalError);
    if(E.personalPrune)E.personalPrune.onclick=()=>personalRequest({t:'personal_data_prune',requestId:personalReqId()}).catch(personalError);
    if(E.personalEraseCategoryButton)E.personalEraseCategoryButton.onclick=personalEraseSelectedCategory;
    if(E.personalErase)E.personalErase.onclick=personalEraseEverything;
    personalSourceTypeUi();personalResetFavorite();personalResetVehicle();personalResetPreference();

    // ---------- settings (persistente) ----------
    E.settingsBtn.onclick=()=>{ E.settings.classList.remove('hidden'); const mc=availableMachineCaps(); fillSel(E.setAgent,mc.map(c=>({id:c.name,label:c.label||c.name})),cfg.agent||currentAgent); const c=mc.find(x=>x.name===E.setAgent.value)||capsFor(E.setAgent.value);
      const sm=selectableModels(c), defaultModel=(sm.some(m=>m.id===cfg.model)&&cfg.model)||(sm.some(m=>m.id===c.defaultModel)&&c.defaultModel)||(sm[0]||{}).id||'';
      fillSel(E.setModel,modelControlOf(c)==='per_turn'?sm:[],defaultModel); fillEfforts(E.setEffort,E.setAgent.value,E.setModel.value,cfg.effort);
      E.setVoice.checked=cfg.voice; E.setContinue.checked=cfg.continue; E.setContinueSec.value=cfg.continueSec; if(E.setSilenceSec)E.setSilenceSec.value=cfg.silenceSec; E.setWake.checked=cfg.wake; E.setNoise.checked=cfg.noise; if(E.setSlash)E.setSlash.checked=(cfg.slashMenu!==false); E.setPush.checked=!!cfg.push; if(E.setBioLock)E.setBioLock.checked=!!cfg.bioLock; E.pushDone.checked=(cfg.pushEvents||[]).includes('done'); E.pushError.checked=(cfg.pushEvents||[]).includes('error'); E.pushMachine.checked=(cfg.pushEvents||[]).includes('machine'); E.pushMode.value=cfg.pushMode||'each'; E.pushEvery.value=cfg.pushEvery||15; renderPushCfg(); requestPushStatus(); E.setGate.checked=cfg.voiceGate; renderSpk(); tx({t:'speakers'}); tx({t:'list_voices'});
      fillSumSelects(); tx({t:'summary_cfg'});
      renderUpdate(); E.updStatus.textContent='Verificando…'; tx({t:'update_check'});
      const isOwner=authUser&&authUser.role==='owner'; E.routinesSection.classList.toggle('hidden',!isOwner); E.executionSettings.classList.toggle('hidden',!isOwner); if(E.frameworkSettings)E.frameworkSettings.classList.toggle('hidden',!isOwner); if(E.policySettings)E.policySettings.classList.toggle('hidden',!isOwner); if(E.fallbackSettings)E.fallbackSettings.classList.toggle('hidden',!isOwner); if(E.logSettings)E.logSettings.classList.toggle('hidden',!isOwner); if(isOwner){ fillRoutineMachines(); validateRoutineCron(); tx({t:'routines'}); tx({t:'execution_cfg'}); tx({t:'framework_cfg'}); tx({t:'framework_inventory'}); tx({t:'framework_updates'}); fwArmInventory(); tx({t:'fallback_cfg'}); tx({t:'log_cfg'}); tx({t:'policy_state',sessionId:currentSession}); }
      settingsSetupNav(isOwner);
      tx({t:'voice_cfg'}); requestPersonalState(); if(E.setLang) E.setLang.value=lang; };
    // ---------- configurações: navegação lateral + busca (like Claude/VS Code) ----------
    // Nenhuma lógica de preencher/salvar muda: os IDs dos controles são os mesmos; aqui só
    // decidimos QUAL painel aparece. Owner-only: esconde os itens de nav e mostra um aviso.
    // "O painel X está à vista?" = configurações abertas E o painel não escondido (na busca todos
    // aparecem). Usado por eventos do servidor que só devem repintar o que o usuário está vendo.
    function settingsPanelOpen(name){ const root=E.settings; if(!root||root.classList.contains('hidden')) return false;
      const p=root.querySelector(`.spanel[data-panel="${name}"]`); return !!p&&!p.classList.contains('hidden'); }
    function isNativeShell(){ return document.documentElement.classList.contains('native-shell')||document.documentElement.classList.contains('native'); }
    function settingsGoto(name){ const root=E.settings; if(!root) return;
      if(name==='celular'&&isNativeShell()) name='geral';
      root.querySelectorAll('.snav').forEach(b=>b.classList.toggle('on',b.dataset.goto===name));
      if(E.setSection)E.setSection.value=name;
      root.querySelectorAll('.spanel').forEach(p=>p.classList.toggle('hidden',p.dataset.panel!==name));
      updateSettingsHelpButton(name);
      const panels=document.getElementById('setPanels'); if(panels) panels.scrollTop=0;
      settingsLoadPanel(name);
    }
    // "Uso & custo", "Abrir no celular" e "Dispositivos & convites" eram MODAIS abertos por botões que
    // fechavam as configurações — abrir um item tirava o usuário de onde ele estava. Agora são painéis
    // como os outros, e o fetch que morava no clique do botão passa a acontecer ao ENTRAR no painel
    // (toda reentrada refaz, para não mostrar custo/convite velho).
    function settingsLoadPanel(name){
      if(name==='uso'){ E.fleetBody.innerHTML='Carregando…'; tx({t:'fleet'}); }
      // O QR codifica location.origin — a mesma página — então nunca fica "velho": não limpamos a
      // imagem para não piscar o alt quebrado a cada reentrada.
      else if(name==='celular'&&!isNativeShell()){ if(!E.qrImg.getAttribute('src')) E.qrUrl.textContent='Gerando QR…'; tx({t:'qr',url:location.origin}); }
      else if(name==='dispositivos'&&authUser&&authUser.role==='owner'){ E.secOut.classList.add('hidden'); tx({t:'sec_state'}); }
      else if(['assistente','fontes','dados'].includes(name)){ requestPersonalState(); if(name==='assistente'&&authUser&&authUser.role==='owner')tx({t:'policy_state',sessionId:currentSession}); }
    }
    // Só a visibilidade owner-only — separado de settingsSetupNav porque uma troca de papel com a tela
    // aberta não pode jogar o usuário de volta pro painel Geral.
    function settingsOwnerVisibility(isOwner){ const root=E.settings; if(!root) return;
      // itens exclusivos do dono sÃo escondidos da barra; os painéis mostram aviso se abertos por link/busca
      root.querySelectorAll('.snav-owner').forEach(b=>b.classList.toggle('hidden',!isOwner));
      if(E.setSection){Array.from(E.setSection.options).forEach(o=>{if(['automacao','framework','dispositivos'].includes(o.value))o.hidden=!isOwner;if(o.value==='celular')o.hidden=isNativeShell();});}
      [['autoOwnerHint',null],['fwOwnerHint',null],['secOwnerHint','secSettings']].forEach(([hintId,bodyId])=>{
        const hint=document.getElementById(hintId); if(hint) hint.classList.toggle('hidden',!!isOwner);
        if(bodyId){ const body=document.getElementById(bodyId); if(body) body.classList.toggle('hidden',!isOwner); }
      });
    }
    function settingsSetupNav(isOwner){ const root=E.settings; if(!root) return;
      settingsOwnerVisibility(isOwner);
      // volta pro painel Geral e limpa a busca toda vez que abre
      if(E.setSearch) E.setSearch.value=''; settingsSearch(''); root.classList.remove('searchopen'); settingsGoto('geral');
    }
    // Busca: mostra TODOS os painéis mas filtra linha a linha (label/.sec) pelo texto, como no Claude.
    const setSearchLoaded=new Set();
    function settingsSearch(q){ const root=E.settings; if(!root) return; q=(q||'').trim().toLowerCase();
      root.classList.toggle('searching',!!q);
      if(!q){ root.querySelectorAll('.searchhide').forEach(el=>el.classList.remove('searchhide')); root.querySelectorAll('.spanel.nomatch').forEach(p=>p.classList.remove('nomatch')); const nr=document.getElementById('setNoResults'); if(nr)nr.classList.add('hidden'); setSearchLoaded.clear(); return; }
      let total=0;
      root.querySelectorAll('.spanel').forEach(p=>{ let shown=0; let curSec=null, secHas=false;
        const flush=()=>{ if(curSec) curSec.classList.toggle('searchhide',!secHas); };
        Array.from(p.children).forEach(el=>{
          if(el.classList.contains('sec')){ flush(); curSec=el; secHas=false; return; }
          if(el.tagName==='LABEL'){ const hit=el.textContent.toLowerCase().includes(q); el.classList.toggle('searchhide',!hit); if(hit){ shown++; secHas=true; } return; }
          // blocos (routine-grid, div wrappers): varre labels internos
          const labs=el.querySelectorAll?el.querySelectorAll('label'):[]; let any=false;
          labs.forEach(l=>{ const hit=l.textContent.toLowerCase().includes(q); l.classList.toggle('searchhide',!hit); if(hit) any=true; });
          if(labs.length){ if(any){ shown++; secHas=true; } }
        });
        flush(); p.classList.toggle('nomatch',shown===0); total+=shown;
        // A busca também "abre" painéis: sem isto, achar "senha do dono" mostraria a seção com as
        // listas vazias. Uma vez por busca, para não disparar fetch a cada tecla.
        if(shown&&!setSearchLoaded.has(p.dataset.panel)){ setSearchLoaded.add(p.dataset.panel); settingsLoadPanel(p.dataset.panel); }
      });
      const nr=document.getElementById('setNoResults'); if(nr)nr.classList.toggle('hidden',total>0);
    }
    function settingsCollapseSearch(){ if(E.settings) E.settings.classList.remove('searchopen'); }
    document.querySelectorAll('#settings .snav').forEach(b=>b.onclick=()=>{ if(E.setSearch){E.setSearch.value='';} settingsSearch(''); settingsCollapseSearch(); settingsGoto(b.dataset.goto); });
    if(E.setSection)E.setSection.onchange=()=>{if(E.setSearch)E.setSearch.value='';settingsSearch('');settingsCollapseSearch();settingsGoto(E.setSection.value);};
    if(E.settingsHelpBtn) E.settingsHelpBtn.onclick=()=>openSettingsHelp();
    if(E.setSearch) E.setSearch.oninput=()=>settingsSearch(E.setSearch.value);
    // Mobile: search is a tab-like item that expands into the input on tap and collapses when empty.
    if(E.setSearchToggle) E.setSearchToggle.onclick=()=>{ if(E.settings)E.settings.classList.add('searchopen'); setTimeout(()=>{ if(E.setSearch) E.setSearch.focus(); },20); };
    if(E.setSearch) E.setSearch.addEventListener('blur',()=>{ if(!E.setSearch.value.trim()) settingsCollapseSearch(); });
    // Ajuda detalhada por subseção (Fatia 1): botão ? em cada .sec abre o painel de ajuda.
    document.querySelectorAll('#settings [data-help]').forEach(b=>b.addEventListener('click',e=>{ e.preventDefault(); e.stopPropagation(); openHelpSheet(b.dataset.help); }));
    if(E.helpSheetClose) E.helpSheetClose.onclick=closeHelpSheet;
    if(E.helpSheet){ E.helpSheet.addEventListener('click',e=>{ if(e.target===E.helpSheet) closeHelpSheet(); }); E.helpSheet.addEventListener('keydown',e=>{ if(e.key==='Escape'){ e.stopPropagation(); closeHelpSheet(); } }); }
    // Meu Framework (universal) — owner-only editor + fleet publish.
    let fwMachineStatus={};
    function fwStateLabel(st){ return ({materialized:'✓ materializado',current:'✓ já atual',sent:'enviado',queued:'na fila',needs_update:'⚠ máquina desatualizada',error:'⚠ erro',offline:'offline',pronta:'pronta',fonte:'fonte (esta máquina)'})[st]||st; }
    function renderFwStatus(){ const ids=Object.keys(fwMachineStatus); E.fwStatus.innerHTML=ids.length?ids.map(id=>'<div>'+esc(fwMachineStatus[id].label)+' — '+esc(fwStateLabel(fwMachineStatus[id].state))+'</div>').join(''):'—'; }
    if(E.setFwPref) E.setFwPref.onchange=()=>tx({t:'set_framework_cfg',preference:E.setFwPref.value,autoStartFlows:E.setFwAutoFlow?E.setFwAutoFlow.checked:undefined});
    // Chave de desligar do dono da máquina: o pacote declara o fluxo padrão, mas quem decide se
    // ele entra sozinho nas sessões é quem está na frente do chat.
    if(E.setFwAutoFlow) E.setFwAutoFlow.onchange=()=>tx({t:'set_framework_cfg',preference:E.setFwPref?E.setFwPref.value:undefined,autoStartFlows:E.setFwAutoFlow.checked});
    if(E.setFwApplyInstr) E.setFwApplyInstr.onchange=()=>tx({t:'set_framework_cfg',preference:E.setFwPref?E.setFwPref.value:undefined,applyInstructions:E.setFwApplyInstr.checked});
    if(E.fwSeed) E.fwSeed.onclick=()=>fwSend('Verificando pacote base',{t:'framework_seed_preview'},E.fwSeed);
    if(E.fwImport) E.fwImport.onclick=()=>fwSend('Verificando instruções desta máquina',{t:'framework_import_native_preview'},E.fwImport);
    if(E.fwPublish) E.fwPublish.onclick=()=>{ E.fwStatus.textContent='Publicando…'; fwSend('Publicando nas máquinas',{t:'publish_framework'},E.fwPublish); };
    // ── Catálogo de skills NATIVAS por IA: lista o que já está instalado em cada provedor e importa para
    // o framework universal (passa a valer no "/" de todas as IAs, com verificação diária de atualização).
    let fwCatLoaded=false, fwCatSelected=new Set(), fwCatalogCache=[], fwCatQuery='', fwCatHidden=new Set();
    try{ fwCatHidden=new Set(JSON.parse(localStorage.getItem('fwCatHidden')||'[]')); }catch(_){}
    function fwCatSaveHidden(){ try{ localStorage.setItem('fwCatHidden',JSON.stringify([...fwCatHidden])); }catch(_){} }
    const FW_PROVIDER_LABEL={claude:'Claude',codex:'Codex',gemini:'Gemini',cursor:'Cursor',copilot:'Copilot',opencode:'OpenCode',cline:'Cline',qwen:'Qwen',continue:'Continue',kiro:'Kiro',antigravity:'Antigravity',aider:'Aider'};
    if(E.fwCatBtn) E.fwCatBtn.onclick=()=>{ if(!E.fwCatalog) return; if(E.fwCatalog.classList.contains('hidden')){ E.fwCatalog.classList.remove('hidden'); E.fwCatBtn.textContent='Ocultar catálogo'; if(!fwCatLoaded) fwSend('Carregando skills instaladas',{t:'framework_native_catalog'},E.fwCatBtn); } else { E.fwCatalog.classList.add('hidden'); E.fwCatBtn.textContent='Ver catálogo'; } };
    function fwCatSyncImportBtn(){ const imp=document.getElementById('fwCatImport'); if(imp){ imp.disabled=!fwCatSelected.size; imp.textContent='Importar ('+fwCatSelected.size+')'; } }
    // Passar `entries` = carga nova (reseta seleção + cache). Sem argumento = re-render (filtro) preservando
    // a seleção. Grupos por IA são <details> COLAPSADOS por padrão (o Cursor pode ter centenas) — abrem ao
    // filtrar. Cada grupo tem "selecionar todos" e contador; um filtro no topo busca por nome/descrição.
    function renderFwCatalog(entries){
      if(entries){ fwCatalogCache=entries; fwCatSelected=new Set(); }
      fwCatLoaded=true; if(!E.fwCatalog) return;
      const list=fwCatalogCache||[];
      if(!list.length){ E.fwCatalog.innerHTML='<div class="mut">Nenhuma skill/comando instalado encontrado nesta máquina.</div>'; return; }
      const q=fwCatQuery.trim().toLowerCase();
      // Universo de IAs (do cache completo) → chips de mostrar/ocultar. Contagem por IA independe do filtro.
      const provCount={}; for(const e of list){ provCount[e.provider]=(provCount[e.provider]||0)+1; }
      const allProvs=Object.keys(provCount).sort();
      const groups={}; for(const e of list){ if(fwCatHidden.has(e.provider)) continue; if(q && !((e.name||'').toLowerCase().includes(q)||(e.description||'').toLowerCase().includes(q))) continue; (groups[e.provider]=groups[e.provider]||[]).push(e); }
      const provs=Object.keys(groups).sort();
      const shown=provs.reduce((n,p)=>n+groups[p].length,0);
      // Skills que vieram de PLUGINS/marketplace (pacotes oficiais do Claude/Codex) — o botão marca
      // todas de uma vez, que é o caso de uso "quero trazer o pacote padrão da IA para o universal".
      const plugAvail=list.filter(e=>e.plugin&&!e.tracked&&!fwCatHidden.has(e.provider));
      const plugAllSel=plugAvail.length&&plugAvail.every(e=>fwCatSelected.has(e.id));
      let html='<div class="row" style="gap:8px;align-items:center;margin-bottom:6px"><input id="fwCatFilter" placeholder="Filtrar skills…" value="'+esc(fwCatQuery)+'" autocomplete="off" style="flex:1;min-width:120px;font-size:12px"><span class="mut" style="font-size:11px;flex:none">'+shown+'/'+list.length+'</span>'
        +(plugAvail.length?'<button id="fwCatPlugins" class="ghost" type="button" title="Seleciona tudo que veio dos pacotes/plugins instalados nas IAs" style="font-size:11px;padding:2px 8px;flex:none">🧩 '+(plugAllSel?'Limpar plugins':'Plugins ('+plugAvail.length+')')+'</button>':'')
        +'<button id="fwCatImport" class="ghost" type="button" style="font-size:11px;padding:2px 8px;flex:none"'+(fwCatSelected.size?'':' disabled')+'>Importar ('+fwCatSelected.size+')</button></div>';
      // Chips por IA: clicar mostra/oculta aquela IA (persiste). Oculta = esmaecida com risco.
      html+='<div class="row" style="gap:4px;flex-wrap:wrap;margin-bottom:6px" title="Clique numa IA para mostrar/ocultar suas skills">'+allProvs.map(p=>{ const hid=fwCatHidden.has(p); return '<button class="ghost fwcat-prov" data-provider="'+esc(p)+'" type="button" style="font-size:10.5px;padding:1px 7px'+(hid?';opacity:.45;text-decoration:line-through':'')+'">'+(hid?'🚫 ':'')+esc(FW_PROVIDER_LABEL[p]||p)+' ('+provCount[p]+')</button>'; }).join('')+'</div>';
      if(!provs.length){ html+='<div class="mut">'+(q?'Nada corresponde ao filtro.':'Todas as IAs estão ocultas — reative nos chips acima.')+'</div>'; E.fwCatalog.innerHTML=html; return; }
      for(const p of provs){
        const items=groups[p].sort((a,b)=>a.name.localeCompare(b.name));
        const selCount=items.filter(e=>fwCatSelected.has(e.id)).length;
        html+='<details class="fwcat-g"'+(q?' open':'')+' style="margin:4px 0;border:1px solid #ffffff12;border-radius:8px;padding:2px 8px"><summary style="cursor:pointer;font-size:12px;display:flex;gap:8px;align-items:center;justify-content:space-between;padding:4px 0"><span><span class="fwcat-cv"></span> <b>'+esc(FW_PROVIDER_LABEL[p]||p)+'</b> <span class="mut">('+items.length+(selCount?' · '+selCount+' sel.':'')+')</span></span><button class="ghost fwcat-all" data-provider="'+esc(p)+'" type="button" style="font-size:10.5px;padding:1px 7px;flex:none">Selecionar todos</button></summary><div style="margin-top:2px">';
        for(const e of items){ const tag=e.kind==='skill'?'skill':'cmd'; const checked=(e.tracked||fwCatSelected.has(e.id))?' checked':''; const dis=e.tracked?' disabled':'';
          html+='<label style="display:flex;gap:8px;align-items:flex-start;padding:3px 4px;font-size:12px"><input type="checkbox" class="fwcat-ck" data-id="'+esc(e.id)+'"'+checked+dis+' style="margin-top:2px"><span style="min-width:0"><b>'+esc(e.name)+'</b> <span class="mut">['+tag+']</span>'+(e.plugin?' <span class="mut" title="Veio de um pacote/plugin instalado na IA">[plugin: '+esc(e.plugin)+']</span>':'')+(e.tracked?' <span style="color:#4ade80">· já importada</span>':'')+(e.description?'<br><span class="mut" style="font-size:11px">'+esc(e.description)+'</span>':'')+'</span></label>';
        }
        html+='</div></details>';
      }
      E.fwCatalog.innerHTML=html;
    }
    if(E.fwCatalog){
      E.fwCatalog.addEventListener('change',e=>{ const ck=e.target.closest('.fwcat-ck'); if(!ck||ck.disabled) return; if(ck.checked) fwCatSelected.add(ck.dataset.id); else fwCatSelected.delete(ck.dataset.id); fwCatSyncImportBtn(); });
      E.fwCatalog.addEventListener('input',e=>{ const f=e.target.closest('#fwCatFilter'); if(!f) return; fwCatQuery=f.value; const pos=f.selectionStart; renderFwCatalog(); const nf=document.getElementById('fwCatFilter'); if(nf){ nf.focus(); try{ nf.setSelectionRange(pos,pos); }catch(_){} } });
      E.fwCatalog.addEventListener('click',e=>{
        const imp=e.target.closest('#fwCatImport'); if(imp){ const ids=[...fwCatSelected]; if(!ids.length){ toast('Selecione ao menos uma skill.'); return; } fwSend('Importando '+ids.length+' skill(s)',{t:'framework_import_native_skill_preview',ids},imp); return; }
        const plg=e.target.closest('#fwCatPlugins'); if(plg){ const avail=(fwCatalogCache||[]).filter(x=>x.plugin&&!x.tracked&&!fwCatHidden.has(x.provider)); const allSel=avail.length&&avail.every(x=>fwCatSelected.has(x.id)); avail.forEach(x=>{ if(allSel) fwCatSelected.delete(x.id); else fwCatSelected.add(x.id); }); renderFwCatalog(); return; }
        const prov=e.target.closest('.fwcat-prov'); if(prov){ const p=prov.dataset.provider; if(fwCatHidden.has(p)){ fwCatHidden.delete(p); } else { fwCatHidden.add(p); fwCatalogCache.forEach(en=>{ if(en.provider===p) fwCatSelected.delete(en.id); }); } fwCatSaveHidden(); renderFwCatalog(); return; }
        const all=e.target.closest('.fwcat-all'); if(all){ e.preventDefault(); e.stopPropagation(); const det=all.closest('.fwcat-g'); if(!det) return; const cks=[...det.querySelectorAll('.fwcat-ck:not(:disabled)')]; const allSel=cks.length&&cks.every(c=>fwCatSelected.has(c.dataset.id)); cks.forEach(c=>{ if(allSel){ fwCatSelected.delete(c.dataset.id); c.checked=false; } else { fwCatSelected.add(c.dataset.id); c.checked=true; } }); all.textContent=allSel?'Selecionar todos':'Limpar seleção'; fwCatSyncImportBtn(); }
      });
    }
    // ── Fluxos de trabalho (F1): o Jarvis PROPÕE os passos lidos da skill; você confirma/edita e salva.
    // Nada é salvo sem confirmação, e o fluxo salvo vai junto na publicação (vale em todas as máquinas).
    let fwWfLoaded=false, fwWfDraft=null, fwWfSugOpen=false;
    if(E.fwWfBtn) E.fwWfBtn.onclick=()=>{ if(!E.fwWorkflows) return; if(E.fwWorkflows.classList.contains('hidden')){ E.fwWorkflows.classList.remove('hidden'); E.fwWfBtn.textContent='Ocultar fluxos'; fwSend('Carregando fluxos',{t:'workflow_list'},E.fwWfBtn); } else { E.fwWorkflows.classList.add('hidden'); E.fwWfBtn.textContent='Ver fluxos'; } };
    function renderFwWorkflows(m){
      fwWfLoaded=true; if(!E.fwWorkflows) return;
      const defs=(m&&m.workflows)||[], cands=(m&&m.candidates)||[];
      // Agrupado por PACOTE: a pergunta "de onde veio isso" se responde no cabeçalho, não em cada item.
      // A chave é o nome do pacote; sem pacote, tudo cai num grupo "local" (feito nesta máquina).
      // Prefixo em toda chave de pacote para que nenhum nome de pacote possa colidir com "local".
      const LOCAL='local';
      const chave=(p)=>p&&p.name?('p:'+p.name):LOCAL;
      const cab=(k,p)=>{ if(k===LOCAL) return '✎ <b>Feitos nesta máquina</b>';
        return '📦 <b>'+esc(p.title||p.name)+'</b>'+(p.version?' <span class="mut">v'+esc(p.version)+'</span>':'')
          +(p.declared?'':' <span class="wfchip">sem identidade</span>'); };
      // Agrupa preservando a ordem de aparição, e deixa o grupo "local" por último.
      const agrupar=(itens)=>{ const g=new Map();
        for(const it of itens){ const k=chave(it.pack); if(!g.has(k)) g.set(k,{pack:it.pack,itens:[]}); g.get(k).itens.push(it); }
        return [...g].sort((a,b)=>a[0]===LOCAL?1:b[0]===LOCAL?-1:a[0].localeCompare(b[0])); };

      const origem=(src)=>{ const p=src&&src.path; if(!p) return '';
        const skill=/^skills\/([^/]+)\//.exec(p); const nome=skill?skill[1]:p;
        return '<span class="wforig" title="'+esc(p)+'">📄 '+esc(nome)+'</span>'; };
      const selo=(d)=>(d.via==='flow'
        ? '<span class="wfchip decl" title="veio pronto no pacote — autoritativo">declarado</span>'
        : '<span class="wfchip det" title="montado aqui a partir dos passos escritos na skill">detectado</span>')
        +(d.autoStart?'<span class="wfchip auto" title="inicia sozinho em cada sessão nova (desligável em Configurações → Framework)">padrão</span>':'');
      const selos=(steps)=>{ const g=(steps||[]).filter(x=>x.kind==='gate').length, e=(steps||[]).filter(x=>x.requiresEvidence).length;
        return '<span class="wfchip">'+((steps||[]).length)+' passos</span>'+(g?'<span class="wfchip gate">'+g+' gate</span>':'')+(e?'<span class="wfchip evid">'+e+' evidência</span>':''); };
      const passos=(steps)=>'<ol class="wfsteplist">'+(steps||[]).map(st=>'<li>'+esc(st.title)
        +(st.kind==='gate'?'<span class="wfchip gate">gate</span>':'')
        +(st.requiresEvidence?'<span class="wfchip evid">evidência</span>':'')+'</li>').join('')+'</ol>';
      // Colapsados por padrão (pedido explícito): abrir é escolha, não obrigação de leitura.
      const grupo=(k,p,corpo,n)=>'<details class="wfgroup"><summary><span class="wfcv"></span>'+cab(k,p)
        +'<span class="wfchip">'+n+'</span></summary><div class="wfgbody">'+corpo+'</div></details>';

      // FLUXO é `flows/<id>.json` no pacote — e só. O que a heurística acha lendo a prosa de uma skill
      // é PALPITE, não fluxo: misturar os dois na mesma lista escondia o fluxo declarado no meio de
      // sugestões e fazia parecer que existiam fluxos que ninguém declarou. As sugestões continuam
      // disponíveis, mas atrás de um clique.
      let html='';
      html+='<div class="sec" style="margin-top:0">Fluxos declarados <span class="mut">('+defs.length+')</span></div>';
      html+= defs.length ? agrupar(defs).map(([k,g])=>grupo(k,g.pack,g.itens.map(d=>
          '<details class="wfcard"><summary><span class="wfcv"></span><b>'+esc(d.name||d.id)+'</b>'+selo(d)+selos(d.steps)+origem(d.source)
          +'<button class="ghost fwwf-edit" data-id="'+esc(d.id)+'" type="button">Revisar</button></summary>'+passos(d.steps)+'</details>').join(''),g.itens.length)).join('')
        : '<div class="mut" style="font-size:11.5px;margin-bottom:6px">Nenhum fluxo declarado. Um fluxo é um arquivo <code>flows/&lt;id&gt;.json</code> dentro do pacote — importe um pacote que traga um, ou monte a partir de uma sugestão abaixo.</div>';

      if(cands.length){
        html+='<details class="wfsug"'+(fwWfSugOpen?' open':'')+'><summary>'+cands.length+' skill(s) com passos que <b>poderiam</b> virar fluxo <span class="mut">— sugestões, ainda não são fluxos</span></summary>'
          +'<div class="mut" style="font-size:11.5px;padding:4px 2px 6px">O Jarvis lê os títulos numerados e os GATE escritos na skill e propõe os passos. Só vira fluxo depois que você revisar e salvar — aí nasce o <code>flows/&lt;id&gt;.json</code>.</div>'
          +agrupar(cands).map(([k,g])=>grupo(k,g.pack,g.itens.map(c=>
            '<details class="wfcard"><summary><span class="wfcv"></span><b>'+esc(c.name||c.id)+'</b><span class="wfchip">'+c.steps+' passos detectados</span>'
            +origem({path:c.path})+'<button class="ghost fwwf-detect" data-path="'+esc(c.path)+'" type="button">Detectar</button></summary>'
            +'<div class="mut" style="font-size:11.5px;padding:4px 6px">Origem: <code>'+esc(c.path)+'</code>. Clique em <b>Detectar</b> para ver os passos propostos e revisar antes de salvar.</div></details>').join(''),g.itens.length)).join('')
          +'</details>';
      }

      E.fwWorkflows.innerHTML=html+'<div id="fwWfDraft"></div>';
      // o estado aberto/fechado das sugestões sobrevive ao re-render (salvar um fluxo recarrega a lista)
      const sug=E.fwWorkflows.querySelector('.wfsug');
      if(sug) sug.addEventListener('toggle',()=>{ fwWfSugOpen=sug.open; });
      if(fwWfDraft) renderFwWfDraft();
    }
    // Rascunho editável: o humano confirma cada passo, marca gate / exige evidência, remove o que não serve.
    function renderFwWfDraft(){
      const host=document.getElementById('fwWfDraft'); if(!host||!fwWfDraft) return;
      const steps=fwWfDraft.steps||[];
      host.innerHTML='<div style="margin-top:8px;border:1px solid #2b3550;border-radius:8px;padding:10px;background:#121a26">'
        +'<div class="sec" style="margin-top:0">Revisar fluxo — '+esc(fwWfDraft.name||fwWfDraft.id)+'</div>'
        +'<div class="mut" style="font-size:11.5px;margin-bottom:6px">Confira os passos lidos da skill. Desmarque o que não for passo, marque os que são <b>gate</b> (só sinaliza) ou que <b>exigem evidência</b>.</div>'
        +(steps.length?steps.map((s,i)=>'<label style="display:flex;gap:8px;align-items:flex-start;padding:3px 4px;font-size:12px;border-top:1px solid #ffffff0d">'
          +'<input type="checkbox" class="wfk" data-i="'+i+'"'+(s._off?'':' checked')+' style="margin-top:2px">'
          +'<span style="flex:1;min-width:0"><b>'+esc(s.title)+'</b>'+(s.hint?'<br><span class="mut" style="font-size:11px">'+esc(s.hint)+'</span>':'')+'</span>'
          +'<span class="row" style="gap:6px;flex:none;font-size:11px"><label><input type="checkbox" class="wfg" data-i="'+i+'"'+(s.kind==='gate'?' checked':'')+'> gate</label>'
          +'<label><input type="checkbox" class="wfe" data-i="'+i+'"'+(s.requiresEvidence?' checked':'')+'> evidência</label></span></label>').join(''):'<div class="mut">Nada detectado — escreva os passos na skill e detecte de novo.</div>')
        +'<div class="row" style="gap:8px;justify-content:flex-end;margin-top:8px"><button id="fwWfCancel" class="ghost" type="button">Cancelar</button><button id="fwWfSave" type="button">Salvar fluxo</button></div></div>';
    }
    if(E.fwWorkflows){
      E.fwWorkflows.addEventListener('change',e=>{ const k=e.target.closest('.wfk'),g=e.target.closest('.wfg'),v=e.target.closest('.wfe'); if(!fwWfDraft) return;
        if(k){ const s=fwWfDraft.steps[+k.dataset.i]; if(s) s._off=!k.checked; }
        else if(g){ const s=fwWfDraft.steps[+g.dataset.i]; if(s) s.kind=g.checked?'gate':'step'; }
        else if(v){ const s=fwWfDraft.steps[+v.dataset.i]; if(s) s.requiresEvidence=v.checked; } });
      E.fwWorkflows.addEventListener('click',e=>{
        // os botões vivem dentro do <summary>: sem isto, clicar neles também abriria/fecharia o cartão
        const det=e.target.closest('.fwwf-detect'); if(det){ e.preventDefault(); fwSend('Detectando fluxo em '+det.dataset.path,{t:'workflow_detect',path:det.dataset.path}); return; }
        const ed=e.target.closest('.fwwf-edit'); if(ed){ e.preventDefault(); const d=(fwWfCache.workflows||[]).find(x=>x.id===ed.dataset.id); if(d){ fwWfDraft=JSON.parse(JSON.stringify(d)); renderFwWfDraft(); } return; }
        if(e.target.closest('#fwWfCancel')){ fwWfDraft=null; const h=document.getElementById('fwWfDraft'); if(h)h.innerHTML=''; return; }
        if(e.target.closest('#fwWfSave')){ if(!fwWfDraft) return; const def=Object.assign({},fwWfDraft,{steps:(fwWfDraft.steps||[]).filter(s=>!s._off).map(s=>({id:s.id,title:s.title,kind:s.kind,requiresEvidence:!!s.requiresEvidence,hint:s.hint}))});
          if(!def.steps.length){ toast('Marque ao menos um passo.'); return; } fwSend('Salvando fluxo '+(def.name||def.id),{t:'workflow_save',definition:def}); return; }
      });
    }
    let fwWfCache={};
    // Banner "atualizações disponíveis" — populado pela verificação diária (notify-only; nada é aplicado
    // sem confirmação). "Revisar" dispara o mesmo update-check → prévia → aplicar das fontes.
    function renderFwUpdates(alerts){
      if(!E.fwUpdates) return; const a=alerts||[];
      if(!a.length){ E.fwUpdates.classList.add('hidden'); E.fwUpdates.innerHTML=''; return; }
      E.fwUpdates.classList.remove('hidden');
      E.fwUpdates.innerHTML='<div style="font-weight:600;margin-bottom:4px">🔔 '+a.length+' atualização(ões) disponível(is)</div>'+a.map(u=>{ const flag=u.scanBlocked?' <span style="color:#f87171">· sinalizada (revisar)</span>':''; return '<div class="row" style="justify-content:space-between;align-items:center;gap:8px;margin:2px 0"><span style="min-width:0">'+esc(u.label||u.id)+' <span class="mut">('+esc(u.type)+(u.changed?', '+u.changed+' arq.':'')+')</span>'+flag+'</span><button class="ghost fw-upd-review" data-id="'+esc(u.id)+'" type="button" style="font-size:11px;padding:2px 8px">Revisar</button></div>'; }).join('');
    }
    if(E.fwUpdates) E.fwUpdates.addEventListener('click',e=>{ const r=e.target.closest('.fw-upd-review'); if(!r) return; fwSend('Buscando atualização',{t:'framework_update_check',id:r.dataset.id}); });
    // Framework: inventário, importação com gate de segurança (zip/GitHub) e atualização por fonte.
    let fwSourcesCache=[], fwPreviewToken='', fwPreviewBlocked=false, fwPreviewSelected=new Set(), fwWatchdog=null, fwInvTimer=null, fwLogSeeded=false;
    let fwInvCache=null;   // último inventário recebido — o "Limpar tudo" precisa saber o tamanho do estrago
    // Problemas e Fontes nascem COLAPSADOS. Estes flags só guardam a expansão MANUAL do usuário, para
    // o painel não fechar sozinho no meio da leitura quando o framework re-renderiza (inventário,
    // refresh, publicação). Não são persistidos: recarregar a página volta ao estado colapsado.
    let fwProbOpen=false, fwSrcOpen=false;
    // Registro visível "O que foi feito": cada ação anota início e resultado, e um watchdog avisa quando
    // o Hub não responde (Hub desatualizado — as ações novas só existem após reiniciar o Hub).
    function fwLog(html,color){ if(!E.fwLog) return; if(!fwLogSeeded){ E.fwLog.innerHTML=''; fwLogSeeded=true; } const line=document.createElement('div'); line.style.cssText='margin:2px 0'; const ts=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}); line.innerHTML='<span class="mut" style="font-size:10.5px">'+ts+'</span> <span'+(color?(' style="color:'+color+'"'):'')+'>'+html+'</span>'; E.fwLog.insertBefore(line,E.fwLog.firstChild); while(E.fwLog.childNodes.length>30) E.fwLog.removeChild(E.fwLog.lastChild); }
    // Enquanto uma ação está em andamento, TRAVA os botões (feedback claro de "executando" + impede
    // reenvio/spam). fwArrived() é o ponto único que TODA resposta do framework chama → destrava lá;
    // o watchdog também destrava ao desistir (senão o botão ficava clicável e sem feedback).
    let fwPending=false, fwActiveBtn=null;
    const FW_ACTION_BTNS=['fwSeed','fwImport','fwPublish','fwNewFile','fwRefresh','fwZipBtn','fwGhBtn','fwCatBtn','fwWfBtn'];
    // Trava geral + SPINNER no botão clicado (você vê QUAL ação está rodando, não só um log). Destrava
    // no ponto único fwArrived() (toda resposta chama) e no watchdog ao desistir.
    function fwBusy(on,btn){ fwPending=on; FW_ACTION_BTNS.forEach(id=>{ const b=E[id]; if(b) b.disabled=on; }); if(E.frameworkSettings) E.frameworkSettings.classList.toggle('fwbusy',on);
      if(fwActiveBtn){ fwActiveBtn.classList.remove('fwrun'); fwActiveBtn=null; }
      if(on&&btn){ fwActiveBtn=btn; btn.classList.add('fwrun'); } }
    function fwClearWatch(){ if(fwWatchdog){ clearTimeout(fwWatchdog); fwWatchdog=null; } }
    function fwArrived(){ fwClearWatch(); fwBusy(false); }
    function fwArm(){ fwClearWatch(); fwWatchdog=setTimeout(()=>{ fwWatchdog=null; fwBusy(false); fwLog('✖ Sem resposta do Hub — <b>reinicie o Hub</b> para ativar estas ações (elas só existem no Hub atualizado).','#f87171'); },7000); }
    function fwSend(label,msg,btn){ if(fwPending){ fwLog('⏳ já há uma ação em andamento — aguarde…','#f5b544'); return; } fwLog('⏳ '+esc(label)+'…'); fwBusy(true,btn); fwArm(); tx(msg); }
    // Sentinela de abertura: o Hub antigo ainda responde framework_cfg/save (fatia 1), mas NÃO o
    // framework_inventory/import (fatia 2). Só o framework_inventory limpa esta — se estourar, é Hub velho.
    function fwArmInventory(){ if(fwInvTimer)clearTimeout(fwInvTimer); fwInvTimer=setTimeout(()=>{ fwInvTimer=null; fwLog('✖ Hub desatualizado — a árvore de arquivos e o import não respondem. <b>Reinicie o Hub</b> para ativar a gestão de framework.','#f87171'); },7000); }
    const fwStatusBadge=(s)=>({new:'<span style="color:#4ade80">novo</span>',modified:'<span style="color:#f5b544">alterado</span>',unchanged:'<span class="mut">igual</span>',removed:'<span style="color:#f87171">removido</span>'})[s]||esc(s||'');
    const fwSevColor=(sev)=>sev==='high'?'#f87171':sev==='medium'?'#f5b544':'#8aa0c6';
    function fwBuildTree(files){
      const root={dirs:{},files:[]};
      files.forEach(f=>{ const segs=String(f.path).split('/'); let node=root; for(let i=0;i<segs.length-1;i++){ const d=segs[i]; node.dirs[d]=node.dirs[d]||{dirs:{},files:[]}; node=node.dirs[d]; } node.files.push(Object.assign({},f,{leaf:segs[segs.length-1]})); });
      return root;
    }
    const fwExpanded=new Set(); // pastas expandidas no inventário (padrão: tudo colapsado, igual à aba de arquivos da sessão; o usuário expande)
    // Constrói o inventário como DOM aninhado e colapsável: cada pasta tem um container-irmão .fw-tchildren
    // e o toggle é O(1) (só liga/desliga a classe .open), exatamente como o #treeBody da sessão.
    function fwRenderTree(node,depth,prefix,container,probMap){
      probMap=probMap||{};
      Object.keys(node.dirs).sort().forEach(d=>{
        const full=prefix?prefix+'/'+d:d, open=fwExpanded.has(full);
        const row=document.createElement('div'); row.className='fw-node'; row.style.paddingLeft=(depth*14+6)+'px';
        const tw=document.createElement('span'); tw.className='fw-tw'; tw.textContent=open?'▾':'▸';
        const ic=document.createElement('span'); ic.className='ti'; ic.textContent='📁';
        const nm=document.createElement('span'); nm.className='tn'; nm.style.cssText='flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis'; nm.textContent=d; nm.title=full;
        row.append(tw,ic,nm);
        // Excluir a PASTA inteira (uma skill com seus arquivos, um namespace de comandos). Os diretórios
        // de topo (commands/skills) são estruturais — não ganham botão para não virar "apagar tudo".
        if(full.includes('/')){ const fdel=document.createElement('button'); fdel.type='button'; fdel.className='ghost fw-folder-del'; fdel.title='Remover esta pasta e tudo dentro dela'; fdel.setAttribute('aria-label','Remover pasta '+full); fdel.textContent='🗑'; fdel.dataset.path=full; row.appendChild(fdel); }
        const kids=document.createElement('div'); kids.className='fw-tchildren'+(open?' open':'');
        row.onclick=(e)=>{ if(e&&e.target&&e.target.closest&&e.target.closest('.fw-folder-del'))return; const nowOpen=kids.classList.toggle('open'); tw.textContent=nowOpen?'▾':'▸'; if(nowOpen)fwExpanded.add(full); else fwExpanded.delete(full); };
        container.append(row,kids);
        fwRenderTree(node.dirs[d],depth+1,full,kids,probMap);
      });
      node.files.slice().sort((a,b)=>a.leaf.localeCompare(b.leaf)).forEach(f=>{
        const row=document.createElement('div'); row.className='fw-file'; row.dataset.path=f.path; row.setAttribute('role','button'); row.tabIndex=0; row.style.paddingLeft=(depth*14+6)+'px';
        const nm=document.createElement('span'); nm.className='tn'; nm.style.cssText='flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis'; nm.textContent='📄 '+f.leaf; nm.title=f.path;
        const meta=document.createElement('span'); meta.className='mut'; meta.style.fontSize='11px'; meta.innerHTML=(f.tokens||0)+' tk · '+fwStatusBadge(f.status);
        const del=document.createElement('button'); del.type='button'; del.className='ghost fw-file-del'; del.title='Remover do framework'; del.setAttribute('aria-label','Remover '+f.path); del.textContent='🗑'; del.dataset.path=f.path;
        const pm=probMap[f.path];
        if(pm){ const cnt=pm.hi+pm.md+pm.lo+pm.err+pm.warn; const mk=document.createElement('span'); mk.className='fwmark '+((pm.hi||pm.err)?'hi':'md'); mk.textContent='⚠ '+cnt; mk.title='Problemas neste arquivo — clique para abrir na falha'; mk.dataset.path=f.path; mk.dataset.line=pm.line||0; mk.dataset.msg=pm.msg||''; row.append(nm,meta,mk,del); }
        else row.append(nm,meta,del);
        container.appendChild(row);
      });
    }
    let fwInvFiles=[];   // arquivos do inventário atual — usado p/ contar o que sai ao remover uma pasta
    function renderFwInventory(inv,scan,validation){
      if(!E.fwInventory) return;
      const files=(inv&&inv.files)||[];
      fwInvFiles=files;
      // Mapa de problemas por arquivo: achados de segurança + erros/avisos de validação + avisos de orçamento.
      // Alimenta tanto o marcador na árvore quanto o painel navegável.
      const probMap={};
      const addProb=(path,sev,line,msg,kind)=>{ if(!path) return; const m=probMap[path]=probMap[path]||{hi:0,md:0,lo:0,err:0,warn:0,line:0,msg:''}; if(sev==='high')m.hi++; else if(sev==='medium')m.md++; else if(sev==='low')m.lo++; if(kind==='err')m.err++; else if(kind==='warn')m.warn++; if(line&&!m.line)m.line=line; if(msg&&!m.msg)m.msg=msg; };
      const findings=(scan&&scan.findings)||[], issues=(validation&&validation.issues)||[], bwarns=(inv&&inv.warnings)||[];
      findings.forEach(f=>addProb(f.path,f.severity,f.line,f.message));
      issues.forEach(i=>addProb(i.path,null,i.line||0,i.message,i.level==='error'?'err':'warn'));
      bwarns.forEach(w=>addProb(w.path,null,0,w.message,'warn'));
      E.fwInventory.innerHTML='';
      if(files.length) fwRenderTree(fwBuildTree(files),0,'',E.fwInventory,probMap);
      else E.fwInventory.innerHTML='<div class="mut">Nenhum arquivo ainda. Use “Novo arquivo”, o pacote base ou importe um pacote.</div>';
      const t=(inv&&inv.totals)||{};
      const sc=(scan&&scan.counts)||{high:0,medium:0,low:0};
      const scanTxt=scan?('Segurança: '+(sc.high?('<span style="color:#f87171">'+sc.high+' alto(s)</span>'):'<span style="color:#4ade80">0 alto</span>')+', '+sc.medium+' médio(s), '+sc.low+' baixo(s)'):'';
      const valTxt=validation?(' · Validação: '+(validation.errors?('<span style="color:#f87171">'+validation.errors+' erro(s)</span>'):'ok')+(validation.warnings?(', '+validation.warnings+' aviso(s)'):'')):'';
      // Painel de problemas navegável: cada item abre o arquivo na linha da falha.
      const probItems=[]
        .concat(findings.map(f=>({path:f.path,line:f.line||0,label:'<span style="color:'+fwSevColor(f.severity)+'">●</span> <b>'+esc(f.rule)+'</b>',msg:f.message})))
        .concat(issues.map(i=>({path:i.path,line:i.line||0,label:(i.level==='error'?'<span style="color:#f87171">erro</span>':'<span style="color:#f5b544">aviso</span>'),msg:i.message})))
        .concat(bwarns.map(w=>({path:w.path||'',line:0,label:'<span style="color:#f5b544">orçamento</span>',msg:w.message})));
      let probHtml='';
      // Colapsado por padrão SEMPRE — inclusive com severidade alta, que antes abria o painel sozinho
      // e empurrava o resto dos Ajustes para baixo. A contagem no resumo já denuncia que há problema.
      if(probItems.length){ probHtml='<details class="fwprob"'+(fwProbOpen?' open':'')+'><summary>⚠ Problemas ('+probItems.length+') — clique para abrir no arquivo</summary><div style="margin-top:2px">'
        +probItems.slice(0,200).map(p=>'<div class="fwprob-i" role="button" tabindex="0" data-path="'+esc(p.path)+'" data-line="'+p.line+'" data-msg="'+esc(p.msg)+'">'+p.label+' <span class="mut">'+esc(p.path)+(p.line?(':'+p.line):'')+'</span> — '+esc(p.msg)+'</div>').join('')
        +'</div></details>'; }
      E.fwHealth.innerHTML=(files.length?('Sempre-ligado (instruções): <b>~'+(t.alwaysOnTokens||0)+' tk</b> · sob demanda: ~'+(t.onDemandTokens||0)+' tk · catálogo de skills: ~'+(t.metadataTokens||0)+' tk<br>'):'')+scanTxt+valTxt+probHtml;
      // `toggle` não borbulha, então tem que ser ligado no próprio <details> a cada render.
      const pd=E.fwHealth.querySelector('details.fwprob'); if(pd) pd.addEventListener('toggle',()=>{ fwProbOpen=pd.open; });
    }
    function renderFwSources(sources){
      fwSourcesCache=sources||[]; if(!E.fwSources) return;
      if(!fwSourcesCache.length){ E.fwSources.innerHTML=''; return; }
      // Colapsado por padrão: é lista de referência, não algo que se olhe toda hora. O resumo leva a
      // contagem para a informação continuar disponível sem ocupar a tela.
      E.fwSources.innerHTML='<details class="fwsrc"'+(fwSrcOpen?' open':'')+'><summary>Fontes importadas ('+fwSourcesCache.length+')</summary><div>'+fwSourcesCache.map(s=>{
        const label=s.type==='github'?(esc((s.owner||'')+'/'+(s.repo||'')+(s.subdir?'/'+s.subdir:''))+(s.commit?(' @'+esc(String(s.commit).slice(0,7))):'')):esc(s.id||'zip');
        const upd=s.type==='github'?'<button class="ghost fw-src-upd" data-id="'+esc(s.id)+'" type="button" style="font-size:11px;padding:2px 8px">Buscar atualização</button> ':'';
        return '<div class="row" style="justify-content:space-between;align-items:center;gap:8px;margin-top:4px"><span class="mut">'+label+' · '+((s.files||[]).length)+' arq.</span><span>'+upd+'<button class="ghost fw-src-del" data-id="'+esc(s.id)+'" type="button" style="font-size:11px;padding:2px 8px">Remover</button></span></div>';
      }).join('')+'</div></details>';
      const sd=E.fwSources.querySelector('details.fwsrc'); if(sd) sd.addEventListener('toggle',()=>{ fwSrcOpen=sd.open; });
    }
    const fwSrcLabel=(source)=>({github:'GitHub: '+esc((source.repo||''))+(source.ref?(' @'+esc(source.ref)):''),zip:'Zip: '+esc(source.name||''),dir:'Pasta: '+esc(source.name||'')+(source.path?(' <span class="mut">'+esc(source.path)+'</span>'):''),starter:'Pacote base (embutido)',native:'Instruções desta máquina'})[source.type]||'Importação';
    const fwSrcShort=(source)=>({github:'GitHub',zip:'Zip',dir:'Pasta',starter:'Pacote base',native:'Desta máquina'})[source.type]||'Importação';
    function fwUpdateApplyState(){ if(!E.fwPreviewApply) return; const forced=!!(E.fwPreviewForce&&E.fwPreviewForce.checked); E.fwPreviewApply.disabled=(fwPreviewBlocked&&!forced)||!fwPreviewSelected.size; E.fwPreviewApply.textContent=fwPreviewSelected.size?('Aplicar '+fwPreviewSelected.size+' arquivo(s)'):'Aplicar'; }
    function renderFwPreview(token,source,p,isUpdate){
      fwPreviewToken=token; fwPreviewBlocked=!!(p.scan&&p.scan.blocked); source=source||{}; p=p||{};
      const srcLabel=fwSrcLabel(source);
      if(E.fwPreviewTitle)E.fwPreviewTitle.textContent=(isUpdate?'Atualização':'Prévia')+' — '+fwSrcShort(source);
      const sc=(p.scan&&p.scan.counts)||{high:0,medium:0,low:0};
      const c=(p.counts)||{new:0,modified:0,unchanged:0};
      const diffTxt=(isUpdate||c.modified||c.unchanged)
        ? ('<span style="color:#4ade80">'+c.new+' novo(s)</span>, <span style="color:#f5b544">'+c.modified+' duplicado(s) alterado(s)</span>, '+c.unchanged+' idêntico(s)')
        : (c.new+' novo(s)');
      // Lista selecionável: cada arquivo que muda vem marcado (dá para excluir da importação); os duplicados
      // que diferem ganham "diferenças" (diff estilo IDE contra a versão atual em disco).
      const invFiles=(p.inventory&&p.inventory.files)||[];
      const changedFiles=invFiles.filter(f=>f.status==='new'||f.status==='modified');
      fwPreviewSelected=new Set(changedFiles.map(f=>f.path));
      const rowsHtml=changedFiles.slice(0,300).map(f=>{ const dup=f.status==='modified';
        return '<label class="fwprow"><input type="checkbox" class="fwpsel" data-path="'+esc(f.path)+'" checked>'
          +'<span class="fwpst '+(dup?'dup':'new')+'">'+(dup?'duplicado':'novo')+'</span>'
          +'<span class="fwpp">'+esc(f.path)+'</span>'
          +(dup?'<button type="button" class="ghost fwpdiff" data-path="'+esc(f.path)+'">diferenças</button>':'')
          +'</label>'; }).join('');
      const findings=((p.scan&&p.scan.findings)||[]).slice(0,40).map(f=>'<div style="margin:2px 0"><span style="color:'+fwSevColor(f.severity)+'">●</span> <b>'+esc(f.rule)+'</b> '+esc(f.path)+(f.line?(':'+f.line):'')+' — '+esc(f.message)+(f.snippet?('<br><code class="mut" style="font-size:11px">'+esc(f.snippet)+'</code>'):'')+'</div>').join('');
      const issues=((p.validation&&p.validation.issues)||[]).slice(0,30).map(i=>'<div class="mut" style="margin:1px 0">'+(i.level==='error'?'<span style="color:#f87171">erro</span>':'aviso')+': '+esc(i.path)+' — '+esc(i.message)+'</div>').join('');
      const t=(p.inventory&&p.inventory.totals)||{}, skipped=(p.skipped||[]);
      // Identidade do pacote: quem se declara aparece pelo nome; quem não se declara é aceito com aviso.
      const mf=p.manifest;
      const packLine=mf
        ? '<div style="margin-top:4px">📦 <b>'+esc(mf.title||mf.name)+'</b>'+(mf.version?' <span class="mut">v'+esc(mf.version)+'</span>':'')+(mf.description?' — <span class="mut">'+esc(mf.description)+'</span>':'')+'</div>'
        : '<div class="mut" style="margin-top:4px">📦 sem <code>jarvis.pack.json</code> — importa igual, mas a origem fica inferida da fonte.</div>';
      // Projeção declarada: separa "o pacote decidiu não trazer" de "ficou de fora por acidente".
      const pj=p.projection||{}, mapErr=(mf&&mf.mapErrors)||[];
      const projLine=(pj.mapped||pj.excluded)
        ? '<div class="mut" style="margin-top:2px">🗺️ projeção declarada: <b>'+(pj.mapped||0)+'</b> arquivo(s) reposicionado(s)'
          +(pj.excluded?', <b>'+pj.excluded+'</b> excluído(s) de propósito':'')+'</div>'
        : '';
      const mapErrLine=mapErr.length
        ? '<div style="margin-top:2px;color:#f5b544">⚠ '+mapErr.length+' regra(s) de projeção recusada(s): '+mapErr.slice(0,4).map(esc).join('; ')+'</div>'
        : '';
      // Conformidade: o que ENTRA mas não vai funcionar. Vem antes da lista de arquivos porque é a
      // informação que muda a decisão — "103 novos" sem isto parece sucesso.
      const cf=p.conformance||{}, cfIssues=(cf.issues||[]).filter(i=>i.code!=='pacote-sem-manifesto');
      const cfRows=cfIssues.map(i=>'<div style="margin:3px 0"><span style="color:'+(i.level==='error'?'#f87171':'#f5b544')+'">●</span> <b>'+esc(i.path)+'</b>'
        +(i.files?' <span class="mut">('+i.files+' arq.)</span>':'')+'<br><span class="mut" style="font-size:11px">'+esc(i.message)+'</span>'
        +((i.sample||[]).length?'<br><code class="mut" style="font-size:10.5px">'+i.sample.map(esc).join('<br>')+'</code>':'')+'</div>').join('');
      const inert=cf.inertSkillFiles||0;
      const cfBanner=inert
        ? '<div style="margin-top:6px;border:1px solid #f8717155;background:#f8717112;border-radius:6px;padding:6px 8px">'
          +'<b style="color:#f87171">⚠ '+inert+' arquivo(s) sob skills/ não serão carregados por IA nenhuma.</b>'
          +'<div class="mut" style="font-size:11.5px;margin-top:2px">Uma skill é <code>skills/&lt;nome&gt;/SKILL.md</code>. '
          +(cf.loadableSkills?('Deste pacote, <b>'+cf.loadableSkills+'</b> skill(s) funcionam.'):'<b>Nenhuma</b> skill deste pacote funciona.')
          +' Material de apoio deve ir em <code>reference/</code>.</div></div>'
        : '';
      if(E.fwPreviewBody)E.fwPreviewBody.innerHTML=
        '<div>'+srcLabel+' · <b>'+(p.fileCount||0)+'</b> arquivo(s) · ~'+(t.tokens||0)+' tk</div>'
        +packLine+projLine+mapErrLine
        +'<div style="margin-top:4px">Mudanças: '+diffTxt+'</div>'
        +cfBanner
        +(p.identical?'<div style="margin-top:4px;color:#4ade80">✓ Idêntico ao atual — nada a aplicar.</div>':'')
        +'<div style="margin-top:4px">Segurança: '+(sc.high?('<b style="color:#f87171">'+sc.high+' alto(s) — bloqueado</b>'):'<span style="color:#4ade80">0 alto</span>')+', '+sc.medium+' médio(s), '+sc.low+' baixo(s)</div>'
        +(rowsHtml?('<div class="fwplist">'+rowsHtml+'</div><div class="mut" style="font-size:11px;margin-top:3px">Desmarque o que não quiser importar. Tudo pode ser removido depois pela lista do inventário.</div>'):'')
        +(c.unchanged?('<div class="mut" style="margin-top:3px;font-size:11px">'+c.unchanged+' arquivo(s) idêntico(s) já existem — não serão alterados.</div>'):'')
        +(findings?('<details class="fwpsec"'+(sc.high?' open':'')+'><summary>Achados de segurança ('+((p.scan&&p.scan.findings)||[]).length+')</summary><div style="margin-top:2px">'+findings+'</div></details>'):'')
        +(cfRows?('<details class="fwpsec"'+(cf.errors?' open':'')+'><summary>Conformidade com o padrão ('+cfIssues.length+')</summary><div style="margin-top:2px">'+cfRows+'</div></details>'):'')
        +(issues?('<details class="fwpsec"><summary>Validação ('+((p.validation&&p.validation.issues)||[]).length+')</summary><div style="margin-top:2px">'+issues+'</div></details>'):'')
        +(skipped.length?('<div class="mut" style="margin-top:4px">Ignorados: '+skipped.slice(0,20).map(esc).join(', ')+'</div>'):'');
      // Fontes já importadas (ou "buscar atualização") default para Sobrescrever — é o caso de update manual.
      if(E.fwPreviewMode)E.fwPreviewMode.value=isUpdate?'overwrite':'keep';
      if(E.fwPreviewForceRow)E.fwPreviewForceRow.style.display=fwPreviewBlocked?'':'none';
      if(E.fwPreviewForce)E.fwPreviewForce.checked=false;
      fwUpdateApplyState();
      if(E.fwPreview)E.fwPreview.classList.remove('hidden');
    }
    function closeFwPreview(){ fwPreviewToken=''; fwPreviewSelected=new Set(); if(E.fwPreview)E.fwPreview.classList.add('hidden'); }
    // Diff estilo IDE (unificado) de um arquivo da prévia contra a versão atual em disco.
    function fwShowDiff(m){ if(!E.fwDiffModal||!E.fwDiffBody) return; if(E.fwDiffTitle)E.fwDiffTitle.textContent='Diferenças — '+(m.path||''); E.fwDiffBody.innerHTML='';
      if(!m.hasCurrent){ const n=document.createElement('div'); n.className='dline sec'; n.textContent='(arquivo novo — sem versão atual para comparar)'; E.fwDiffBody.appendChild(n); }
      (m.rows||[]).forEach(r=>{ const d=document.createElement('div'); d.className='dline '+(r.t==='+'?'add':r.t==='-'?'del':r.t==='@'?'sec':'ctx'); d.textContent=r.s; E.fwDiffBody.appendChild(d); });
      E.fwDiffModal.classList.remove('hidden'); }
    function fwCloseDiff(){ if(E.fwDiffModal)E.fwDiffModal.classList.add('hidden'); restoreFocusAfterModal(E.fwDiffModal); }
    if(E.fwLogClear) E.fwLogClear.onclick=()=>{ if(E.fwLog){ E.fwLog.innerHTML='—'; fwLogSeeded=false; } };
    if(E.fwRefresh) E.fwRefresh.onclick=()=>fwSend('Atualizando inventário',{t:'framework_inventory'},E.fwRefresh);
    if(E.fwZipBtn) E.fwZipBtn.onclick=()=>E.fwZip&&E.fwZip.click();
    if(E.fwZip) E.fwZip.onchange=()=>{ const f=E.fwZip.files&&E.fwZip.files[0]; if(!f) return; if(f.size>18*1024*1024){ toast('Arquivo muito grande'); E.fwZip.value=''; return; } const r=new FileReader(); r.onload=()=>{ const b64=String(r.result||'').split(',').pop()||''; fwSend('Verificando pacote '+f.name,{t:'framework_import_zip',name:f.name,dataB64:b64},E.fwZipBtn); E.fwZip.value=''; }; r.onerror=()=>{ fwLog('✖ Falha ao ler o arquivo','#f87171'); E.fwZip.value=''; }; r.readAsDataURL(f); };
    if(E.fwGhBtn) E.fwGhBtn.onclick=()=>{ const v=(E.fwGh.value||'').trim(); if(!v){ toast('Informe owner/repo ou URL do GitHub'); return; } fwSend('Baixando de '+v,{t:'framework_import_github',source:v},E.fwGhBtn); };
    // Pasta desta máquina: mesma prévia do zip. Serve para framework sem GitHub e para importar um
    // pacote por vez de um repositório que tem vários (basta apontar para a subpasta do pacote).
    if(E.fwDirBtn) E.fwDirBtn.onclick=()=>{ const v=(E.fwDir.value||'').trim(); if(!v){ toast('Informe o caminho da pasta'); return; } fwSend('Lendo a pasta '+v,{t:'framework_import_dir',path:v},E.fwDirBtn); };
    if(E.fwDir) E.fwDir.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); if(E.fwDirBtn) E.fwDirBtn.click(); } });
    // Limpar tudo: destrutivo e local. Dupla confirmação com o NÚMERO de arquivos, porque "limpar" sem
    // saber o tamanho do estrago é o tipo de botão que a pessoa clica achando que dá para desfazer.
    if(E.fwReset) E.fwReset.onclick=()=>{
      const n=(fwInvCache&&fwInvCache.inventory&&fwInvCache.inventory.totals&&fwInvCache.inventory.totals.files)||0;
      if(!n){ toast('O framework já está vazio.'); return; }
      if(!confirm('Apagar TODO o framework desta máquina?\n\n'+n+' arquivo(s) em commands/, skills/, flows/, reference/ e instructions.md, mais o registro de fontes importadas.\n\nNão dá para desfazer. As outras máquinas só perdem o conteúdo quando você publicar depois.')) return;
      if(!confirm('Confirma? Isto apaga os '+n+' arquivo(s) agora.')) return;
      fwSend('Limpando o framework',{t:'framework_reset'},E.fwReset);
    };
    // Modelo de pacote: chega em base64 pela própria conexão e vira download no navegador.
    if(E.fwTplBtn) E.fwTplBtn.onclick=()=>fwSend('Gerando modelo de pacote',{t:'framework_pack_template'},E.fwTplBtn);
    function fwDownloadTemplate(m){
      try{
        const bin=atob(m.dataB64||''); const bytes=new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
        const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));
        const a=document.createElement('a'); a.href=url; a.download=m.name||'jarvis-framework-modelo.zip';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(()=>URL.revokeObjectURL(url),5000);
        fwLog('✓ modelo baixado: '+esc(m.name||'')+' — edite e importe pelo zip','#4ade80');
      }catch(err){ fwLog('✖ modelo: '+esc(String(err&&err.message||err)),'#f87171'); toast('Falha ao baixar o modelo'); }
    }
    if(E.fwPreviewForce) E.fwPreviewForce.onchange=fwUpdateApplyState;
    if(E.fwPreviewCancel) E.fwPreviewCancel.onclick=closeFwPreview;
    if(E.fwPreviewApply) E.fwPreviewApply.onclick=()=>{ if(!fwPreviewToken) return; const paths=[...fwPreviewSelected]; if(!paths.length){ toast('Selecione ao menos um arquivo.'); return; } fwSend('Aplicando importação ('+(E.fwPreviewMode.value==='overwrite'?'sobrescrever':'mesclar')+', '+paths.length+' arq.)',{t:'framework_import_apply',token:fwPreviewToken,mode:E.fwPreviewMode.value,force:!!(E.fwPreviewForce&&E.fwPreviewForce.checked),paths}); E.fwPreviewApply.disabled=true; };
    if(E.fwPreviewBody) E.fwPreviewBody.addEventListener('change',e=>{ const cb=e.target.closest('.fwpsel'); if(!cb) return; if(cb.checked)fwPreviewSelected.add(cb.dataset.path); else fwPreviewSelected.delete(cb.dataset.path); fwUpdateApplyState(); });
    if(E.fwPreviewBody) E.fwPreviewBody.addEventListener('click',e=>{ const d=e.target.closest('.fwpdiff'); if(!d) return; e.preventDefault(); if(fwPreviewToken) fwSend('Carregando diferenças de '+d.dataset.path,{t:'framework_import_diff',token:fwPreviewToken,path:d.dataset.path}); });
    if(E.fwDiffClose) E.fwDiffClose.onclick=fwCloseDiff;
    if(E.fwDiffModal) E.fwDiffModal.addEventListener('click',e=>{ if(e.target===E.fwDiffModal) fwCloseDiff(); });
    if(E.fwDiffModal) E.fwDiffModal.addEventListener('keydown',e=>{ if(e.key==='Escape'){ e.stopPropagation(); fwCloseDiff(); } });
    if(E.fwSources) E.fwSources.addEventListener('click',e=>{ const upd=e.target.closest('.fw-src-upd'), del=e.target.closest('.fw-src-del'); if(upd){ fwSend('Buscando atualização',{t:'framework_update_check',id:upd.dataset.id}); } else if(del){ fwSend('Removendo fonte',{t:'framework_source_remove',id:del.dataset.id}); } });
    // Editor de arquivo em modal sobreposto, com guard de alterações não salvas.
    let fwEditPath='', fwEditOrig='', fwEditMode='edit', fwSavingContent='', fwViewMode='edit', fwIsMd=false, fwPendingJump=null, fwWrapOn=false;
    try{ fwWrapOn=localStorage.getItem('fwEditWrap')==='1'; }catch(_){}
    // Abrir um arquivo NA linha da falha (a partir do painel de problemas ou do marcador na árvore): guarda o
    // alvo e pede o arquivo; ao chegar (framework_file), pula para a linha, seleciona e mostra o banner.
    function fwOpenAt(path,line,msg){ if(!path) return; fwPendingJump={path:path,line:line||0,msg:msg||''}; tx({t:'framework_read',path:path}); }
    function fwSetFindingBanner(text){ if(!E.fwEditFinding) return; if(text){ E.fwEditFinding.textContent='⚠ '+text; E.fwEditFinding.classList.remove('hidden'); } else { E.fwEditFinding.textContent=''; E.fwEditFinding.classList.add('hidden'); } }
    // Régua de números de linha, sincronizada com a textarea (rolagem vertical). O editor é sem quebra
    // (wrap=off), então 1 linha lógica = 1 linha visual → os números alinham com as linhas dos achados.
    function fwUpdateGutter(){ if(!E.fwEditGutter||!E.fwEditBody) return; const n=(E.fwEditBody.value.match(/\n/g)||[]).length+1; let s='1'; for(let i=2;i<=n;i++) s+='\n'+i; E.fwEditGutter.textContent=s; E.fwEditGutter.scrollTop=E.fwEditBody.scrollTop; }
    // Quebra de linha (toggle persistido): sem quebra → régua alinhada + scroll horizontal; com quebra →
    // prosa flui, mas a régua fica OCULTA (números não alinhariam com linhas quebradas).
    function fwApplyWrap(){ if(!E.fwEditBody) return; E.fwEditBody.classList.toggle('wrapon',fwWrapOn); try{ E.fwEditBody.wrap=fwWrapOn?'soft':'off'; }catch(_){} if(E.fwEditGutter)E.fwEditGutter.style.display=fwWrapOn?'none':''; if(E.fwEditWrapBtn)E.fwEditWrapBtn.textContent=fwWrapOn?'▦ Exibir linhas: não':'▦ Exibir linhas: sim'; if(!fwWrapOn)fwUpdateGutter(); }
    function fwJumpToLine(line,msg){ if(!E.fwEditBody) return; fwSetView('edit'); const ta=E.fwEditBody; if(line>0){ const lines=ta.value.split('\n'); let start=0; for(let i=0;i<line-1&&i<lines.length;i++) start+=lines[i].length+1; const end=start+((lines[line-1]||'').length); ta.focus(); try{ ta.setSelectionRange(start,end); }catch(_){} const lh=parseFloat(getComputedStyle(ta).lineHeight)||18; ta.scrollTop=Math.max(0,(line-2)*lh); } fwUpdateGutter(); fwSetFindingBanner((line>0?('Linha '+line+': '):'')+(msg||'')); }
    function fwEditDirtyNow(){ return !!E.fwEditBody && (E.fwEditBody.value!==fwEditOrig); }
    function fwSyncDirty(){ if(E.fwEditDirty)E.fwEditDirty.style.display=fwEditDirtyNow()?'':'none'; }
    // Markdown abre renderizado (a maioria dos arquivos é .md); "Editar" mostra a textarea e "Formatado"
    // volta re-renderizando o que está sendo editado. Reusa renderMarkdown/enhanceMarkdown do chat.
    function fwSetView(mode){ fwViewMode=mode; const view=mode==='view'&&fwIsMd;
      if(E.fwEditView){ E.fwEditView.classList.toggle('hidden',!view); if(view){ E.fwEditView.innerHTML=renderMarkdown(E.fwEditBody?E.fwEditBody.value:''); enhanceMarkdown(E.fwEditView); } }
      if(E.fwEditWrap)E.fwEditWrap.style.display=view?'none':'flex';
      if(E.fwEditBody)E.fwEditBody.classList.toggle('hidden',view);
      if(E.fwEditFmt)E.fwEditFmt.textContent=view?'✏️ Editar':'👁 Formatado';
      if(!view){ fwApplyWrap(); setTimeout(()=>{ if(E.fwEditBody)E.fwEditBody.focus(); },0); } }
    function fwOpenNew(){ fwSetFindingBanner(''); fwEditMode='new'; fwEditPath=''; fwEditOrig=''; fwIsMd=false; if(E.fwEditTitle)E.fwEditTitle.textContent='Novo arquivo'; if(E.fwEditPathRow)E.fwEditPathRow.style.display=''; if(E.fwEditPath)E.fwEditPath.value=''; if(E.fwEditBody)E.fwEditBody.value=''; if(E.fwEditDelete)E.fwEditDelete.style.display='none'; if(E.fwEditSave)E.fwEditSave.disabled=false; if(E.fwEditFmt)E.fwEditFmt.classList.add('hidden'); fwSetView('edit'); fwSyncDirty(); if(E.fwEditModal)E.fwEditModal.classList.remove('hidden'); setTimeout(()=>{ if(E.fwEditPath)E.fwEditPath.focus(); },0); }
    function fwShowFile(path,content){ fwSetFindingBanner(''); fwEditMode='edit'; fwEditPath=path||''; fwEditOrig=content||''; if(E.fwEditTitle)E.fwEditTitle.textContent=fwEditPath||'Arquivo'; if(E.fwEditPathRow)E.fwEditPathRow.style.display='none'; if(E.fwEditBody)E.fwEditBody.value=content||''; if(E.fwEditDelete)E.fwEditDelete.style.display=''; if(E.fwEditSave)E.fwEditSave.disabled=false; fwIsMd=/\.(md|markdown|mdx)$/i.test(fwEditPath); if(E.fwEditFmt)E.fwEditFmt.classList.toggle('hidden',!fwIsMd); fwSetView(fwIsMd?'view':'edit'); fwSyncDirty(); if(E.fwEditModal)E.fwEditModal.classList.remove('hidden'); }
    function fwCloseEdit(force){ if(!force && fwEditDirtyNow() && !confirm('Descartar alterações não salvas?')) return false; if(E.fwEditModal){ E.fwEditModal.classList.add('hidden'); E.fwEditModal.classList.remove('max'); } if(E.fwEditMax){ E.fwEditMax.textContent='⛶'; E.fwEditMax.title='Maximizar'; } restoreFocusAfterModal(E.fwEditModal); return true; }
    function fwDoSave(){ const path=fwEditMode==='new'?((E.fwEditPath&&E.fwEditPath.value||'').trim()):fwEditPath; if(!path){ toast('Informe o caminho (ex.: commands/plan.md)'); return; } fwSavingContent=E.fwEditBody?E.fwEditBody.value:''; if(E.fwEditSave)E.fwEditSave.disabled=true; fwSend('Salvando '+path,{t:'framework_save',path:path,content:fwSavingContent}); }
    if(E.fwNewFile) E.fwNewFile.onclick=fwOpenNew;
    if(E.fwInventory) E.fwInventory.addEventListener('click',e=>{ const fdel=e.target.closest('.fw-folder-del'); if(fdel){ e.stopPropagation(); const p=fdel.dataset.path; if(!p) return;
        const n=(fwInvFiles||[]).filter(f=>String(f.path||'').startsWith(p+'/')).length;
        if(confirm('Remover a pasta “'+p+'” e '+n+' arquivo(s) dentro dela?\n\nApaga desta máquina. Publique depois para propagar a remoção às outras.')) fwSend('Removendo pasta '+p,{t:'framework_delete_folder',path:p});
        return; } const del=e.target.closest('.fw-file-del'); if(del){ e.stopPropagation(); const p=del.dataset.path; if(p && confirm('Remover “'+p+'” do framework?\n\nApaga o arquivo desta máquina. Publique depois para propagar a remoção às outras.')) fwSend('Removendo '+p,{t:'framework_delete',path:p}); return; } const mk=e.target.closest('.fwmark'); if(mk){ e.stopPropagation(); fwOpenAt(mk.dataset.path,+mk.dataset.line||0,mk.dataset.msg||''); return; } const el=e.target.closest('.fw-file'); if(el&&el.dataset.path) tx({t:'framework_read',path:el.dataset.path}); });
    // Painel de problemas (dentro de fwHealth): clicar/Enter abre o arquivo na linha da falha.
    if(E.fwHealth){ const openProb=el=>{ if(el) fwOpenAt(el.dataset.path,+el.dataset.line||0,el.dataset.msg||''); };
      E.fwHealth.addEventListener('click',e=>{ openProb(e.target.closest('.fwprob-i')); });
      E.fwHealth.addEventListener('keydown',e=>{ if(e.key!=='Enter'&&e.key!==' ')return; const it=e.target.closest('.fwprob-i'); if(it){ e.preventDefault(); openProb(it); } }); }
    if(E.fwInventory) E.fwInventory.addEventListener('keydown',e=>{ if(e.key!=='Enter'&&e.key!==' ')return; if(e.target.closest('.fw-file-del'))return; const el=e.target.closest&&e.target.closest('.fw-file'); if(el&&el.dataset.path){ e.preventDefault(); tx({t:'framework_read',path:el.dataset.path}); } });
    if(E.fwEditBody) E.fwEditBody.addEventListener('input',()=>{ fwSyncDirty(); fwUpdateGutter(); });
    if(E.fwEditBody) E.fwEditBody.addEventListener('scroll',()=>{ if(E.fwEditGutter) E.fwEditGutter.scrollTop=E.fwEditBody.scrollTop; });
    if(E.fwEditSave) E.fwEditSave.onclick=fwDoSave;
    if(E.fwEditCancel) E.fwEditCancel.onclick=()=>fwCloseEdit(false);
    if(E.fwEditClose) E.fwEditClose.onclick=()=>fwCloseEdit(false);
    if(E.fwEditFmt) E.fwEditFmt.onclick=()=>fwSetView(fwViewMode==='view'?'edit':'view');
    if(E.fwEditWrapBtn) E.fwEditWrapBtn.onclick=()=>{ fwWrapOn=!fwWrapOn; try{ localStorage.setItem('fwEditWrap',fwWrapOn?'1':'0'); }catch(_){} fwApplyWrap(); };
    if(E.fwEditMax) E.fwEditMax.onclick=()=>{ const max=E.fwEditModal.classList.toggle('max'); E.fwEditMax.textContent=max?'🗗':'⛶'; E.fwEditMax.title=max?'Restaurar':'Maximizar'; };
    if(E.fwEditDelete) E.fwEditDelete.onclick=()=>{ if(!fwEditPath){ fwCloseEdit(true); return; } if(!confirm('Excluir '+fwEditPath+'?')) return; fwSend('Excluindo '+fwEditPath,{t:'framework_delete',path:fwEditPath}); };
    if(E.fwEditModal) E.fwEditModal.addEventListener('mousedown',e=>{ if(e.target===E.fwEditModal) fwCloseEdit(false); });
    if(E.fwEditModal) E.fwEditModal.addEventListener('keydown',e=>{ if(e.key==='Escape'){ e.stopPropagation(); fwCloseEdit(false); } });
    addEventListener('beforeunload',e=>{ if(E.fwEditModal && !E.fwEditModal.classList.contains('hidden') && fwEditDirtyNow()){ e.preventDefault(); e.returnValue=''; return ''; } });
    if(E.setLang) E.setLang.onchange=()=>setLang(E.setLang.value);
    E.setAgent.onchange=()=>{ const c=capsFor(E.setAgent.value), ms=selectableModels(c), model=(ms.some(m=>m.id===c.defaultModel)&&c.defaultModel)||(ms[0]||{}).id||''; fillSel(E.setModel,modelControlOf(c)==='per_turn'?ms:[],model); fillEfforts(E.setEffort,E.setAgent.value,E.setModel.value); };
    // IA secundária (fallback de limite/crédito) — owner.
    const fbFmt=(ms)=>{ try{ return new Date(ms).toLocaleString('pt-BR',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}); }catch(e){ return ''; } };
    function fillFallbackModels(agent,model,effort){ const c=capsFor(agent), ms=selectableModels(c); const m=(model&&ms.some(x=>x.id===model)&&model)||(ms.some(x=>x.id===c.defaultModel)&&c.defaultModel)||(ms[0]||{}).id||''; fillSel(E.fallbackModel,modelControlOf(c)==='per_turn'?ms:[],m); fillEfforts(E.fallbackEffort,agent,E.fallbackModel.value,effort); }
    function renderFallback(m){ const cfg=m.cfg||{}; const agentList=(caps||[]).map(c=>({id:c.name,label:c.label||c.name})); fillSel(E.fallbackAgent,agentList,cfg.agent||''); fillFallbackModels(cfg.agent||E.fallbackAgent.value,cfg.model,cfg.effort); if(E.fallbackEnabled)E.fallbackEnabled.checked=!!cfg.enabled;
      const blocks=m.blocks||[]; E.fallbackBlocks.innerHTML=blocks.length?('<div style="margin-bottom:2px">Sem crédito agora (usando a secundária):</div>'+blocks.map(b=>'<div class="row" style="justify-content:space-between;align-items:center;gap:8px;margin-top:2px"><span>⚠ '+esc(b.agent)+' — até '+fbFmt(b.blockedUntil)+'</span><button class="ghost fb-clear" data-agent="'+esc(b.agent)+'" type="button" style="font-size:11px;padding:2px 8px">Tentar agora</button></div>').join('')):''; }
    if(E.fallbackAgent) E.fallbackAgent.onchange=()=>fillFallbackModels(E.fallbackAgent.value);
    if(E.fallbackModel) E.fallbackModel.onchange=()=>fillEfforts(E.fallbackEffort,E.fallbackAgent.value,E.fallbackModel.value);
    if(E.fallbackSave) E.fallbackSave.onclick=()=>tx({t:'set_fallback_cfg',enabled:!!(E.fallbackEnabled&&E.fallbackEnabled.checked),agent:E.fallbackAgent.value||'',model:E.fallbackModel.value||'',effort:E.fallbackEffort.value||''});
    if(E.fallbackBlocks) E.fallbackBlocks.addEventListener('click',e=>{ const b=e.target.closest('.fb-clear'); if(b){ tx({t:'fallback_clear',agent:b.dataset.agent}); toast('Tentando a IA primária de novo…'); } });
    // Logs de observabilidade (owner).
    function renderLog(m){ const c=m.cfg||{}; if(E.logEnabled)E.logEnabled.checked=c.enabled!==false; if(E.logLevel&&c.level)E.logLevel.value=c.level; if(E.logRetention&&typeof c.retentionDays==='number')E.logRetention.value=c.retentionDays; if(E.logMaxMb&&typeof c.maxFileMb==='number')E.logMaxMb.value=c.maxFileMb; }
    if(E.logSave) E.logSave.onclick=()=>tx({t:'set_log_cfg',enabled:!!(E.logEnabled&&E.logEnabled.checked),level:E.logLevel.value,retentionDays:Number(E.logRetention.value)||0,maxFileMb:Number(E.logMaxMb.value)||50});
    // ---------- rotinas agendadas (owner) ----------
    let routineRows=[], routineEditingId='';
    function routineMode(editing){
      routineEditingId=editing||'';
      if(E.rtAdd) E.rtAdd.textContent=routineEditingId?'Salvar rotina':'Adicionar rotina';
      if(E.rtCancel) E.rtCancel.classList.toggle('hidden',!routineEditingId);
    }
    function clearRoutineForm(){
      routineMode('');
      E.rtName.value=''; E.rtPrompt.value=''; E.rtCwd.value=''; E.rtSpeak.checked=false;
      fillRoutineMachines(); validateRoutineCron();
    }
    function routinePatch(){
      return {name:(E.rtName.value||'').trim(),prompt:(E.rtPrompt.value||'').trim(),cron:(E.rtCron.value||'').trim(),hour:0,minute:0,runnerId:E.rtRunner.value||'local',agent:E.rtAgent.value||undefined,model:E.rtModel.value||undefined,effort:E.rtEffort.value||undefined,auto:{agent:!E.rtAgent.value,model:!E.rtModel.value,effort:!E.rtEffort.value},cwd:(E.rtCwd.value||'').trim()||undefined,speak:E.rtSpeak.checked};
    }
    function loadRoutineForm(r){
      if(!r)return;
      routineMode(r.id);
      E.rtName.value=r.name||''; E.rtPrompt.value=r.prompt||''; E.rtCron.value=r.cron||'0 8 * * 1-5'; E.rtCwd.value=r.cwd||''; E.rtSpeak.checked=!!r.speak;
      E.rtRunner.value=r.runnerId||'local'; fillRoutineAgents();
      E.rtAgent.value=(r.auto&&r.auto.agent)?'':(r.agent||''); fillRoutineModels();
      E.rtModel.value=(r.auto&&r.auto.model)?'':(r.model||''); fillRoutineEfforts();
      E.rtEffort.value=(r.auto&&r.auto.effort)?'':(r.effort||'');
      validateRoutineCron(); E.rtName.scrollIntoView({block:'center',behavior:'smooth'}); E.rtName.focus();
    }
    function renderRoutines(list){ if(!E.routinesList)return;
      routineRows=Array.isArray(list)?list:[];
      if(routineEditingId&&!routineRows.some(r=>r.id===routineEditingId)) clearRoutineForm();
      if(!routineRows.length){ E.routinesList.textContent='Nenhuma rotina ainda.'; return; }
      E.routinesList.innerHTML='';
      routineRows.forEach(r=>{ const d=document.createElement('div'); d.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start;padding:8px 0;border-bottom:1px solid var(--line)';
        const machine=(machines.find(m=>m.id===(r.runnerId||'local'))||{}).label||r.runnerId||'servidor';
        const agent=r.auto&&r.auto.agent?'IA automática':(r.agent||'padrão'), model=r.auto&&r.auto.model?'modelo automático':(r.model||'padrão'), effort=r.auto&&r.auto.effort?'esforço automático':(r.effort?effLabel(r.effort):'padrão');
        const info=document.createElement('div'); info.style.cssText='min-width:0';
        info.innerHTML=`<div style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.enabled?'':'⏸ '}${esc(r.name)}</div><div class="mut" style="font-size:11.5px;overflow-wrap:anywhere">${esc(r.label||'')} <span style="opacity:.7">(${esc(r.cron||'legado')})</span></div><div class="mut" style="font-size:11.5px;overflow-wrap:anywhere">Máquina: ${esc(machine)} · IA: ${esc(agent)} · Modelo: ${esc(model)} · Esforço: ${esc(effort)}${r.cwd?' · Pasta: '+esc(r.cwd):''}${r.speak?' · 🔊 fala resultado':''}</div><div class="mut" style="font-size:11px;overflow-wrap:anywhere">${esc(r.prompt||'')}</div>`;
        d.appendChild(info);
        const acts=document.createElement('div'); acts.style.cssText='display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end';
        const mk=(txt,title,fn)=>{ const b=document.createElement('button'); b.type='button'; b.className='ghost'; b.textContent=txt; b.title=title; b.style.cssText='padding:3px 7px;flex:none'; b.onclick=fn; return b; };
        acts.appendChild(mk('✎','Editar',()=>loadRoutineForm(r)));
        acts.appendChild(mk('↻','Rodar agora',()=>{ tx({t:'routine_run',id:r.id}); toast('Rodando “'+r.name+'”…'); }));
        acts.appendChild(mk(r.enabled?'⏸':'▶️', r.enabled?'Pausar':'Ativar', ()=>tx({t:'routine_update',id:r.id,patch:{enabled:!r.enabled}})));
        acts.appendChild(mk('🗑','Remover',async()=>{ if(await dialog({title:`Remover a rotina "${r.name}"?`,okText:'Remover',danger:true})) tx({t:'routine_del',id:r.id}); }));
        d.appendChild(acts);
        E.routinesList.appendChild(d); }); }
    let cronOk=false, cronTimer=null, routineTimezone='local do Hub';
    function validateRoutineCron(){ clearTimeout(cronTimer); cronOk=false; E.rtAdd.disabled=true; E.rtCronHelp.className='cron-help mut'; E.rtCronHelp.textContent='Validando…'; cronTimer=setTimeout(()=>tx({t:'routine_validate',cron:(E.rtCron.value||'').trim()}),180); }
    E.rtAdd.onclick=()=>{ const name=(E.rtName.value||'').trim(), prompt=(E.rtPrompt.value||'').trim(), cron=(E.rtCron.value||'').trim(); if(!name||!prompt){ toast(t('tRtFill')); return; } if(!cronOk){ toast('Corrija a agenda cron antes de adicionar.'); validateRoutineCron(); return; }
      const patch=routinePatch(); if(routineEditingId) tx({t:'routine_update',id:routineEditingId,patch}); else tx({t:'routine_add',routine:patch}); clearRoutineForm(); };
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
    if(E.rtCancel) E.rtCancel.onclick=clearRoutineForm;
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
      if(!adaptiveApprovalEl){ adaptiveApprovalEl=document.createElement('div'); adaptiveApprovalEl.className='toast'; adaptiveApprovalEl.style.cssText='right:14px;left:auto;bottom:calc(var(--composer-height,82px) + 10px);max-width:min(420px,calc(100vw - 28px));display:flex;flex-direction:column;gap:8px;align-items:stretch'; document.body.appendChild(adaptiveApprovalEl); }
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
      E.setPolicyRepoWrites.checked=!!(wr.allowRepoWrites); E.setPolicyDiff.checked=wr.requireDiffPreview!==false; E.setPolicyAutoplay.checked=!!au.allowQueueAutoplay; E.setPolicyBackground.checked=!!au.allowBackgroundTurns;E.setPolicyPersonalContext.checked=!!mem.allowPersonalContext;
      if(typeof renderPersonalContextPolicyAlert==='function')renderPersonalContextPolicyAlert();
      E.setPolicyOverrides.value=JSON.stringify({projects:adaptivePolicyDoc.projects||[],sessions:adaptivePolicyDoc.sessions||[],tasks:adaptivePolicyDoc.tasks||[]},null,2);
      const effBits=[eff.scope||'global',eff.label||'Global'].filter(Boolean).join(' · '), chainTxt=chain.length?chain.map(x=>x.label||x.id).join(' > '):'Global';
      const lbl={allow:'permitido',ask:'aprovação',reject:'bloqueado'}, ic={allow:'✓',ask:'?',reject:'×'}, bg={allow:'#22c55e1f',ask:'#f59e0b22',reject:'#ef444422'}, br={allow:'#22c55e55',ask:'#f59e0b66',reject:'#ef444466'};
      const controls=Array.isArray(exp.controls)?exp.controls:[];
      const chips=controls.map(c=>'<span title="'+esc(c.reason||'')+'" style="display:inline-flex;align-items:center;gap:4px;border:1px solid '+(br[c.state]||'#ffffff24')+';background:'+(bg[c.state]||'#ffffff12')+';border-radius:999px;padding:2px 7px;margin:2px 4px 2px 0">'+(ic[c.state]||'•')+' '+esc(c.label||c.key)+': '+esc(lbl[c.state]||c.state)+'</span>').join('');
      const warnings=Array.isArray(exp.warnings)&&exp.warnings.length?'<div style="color:#fcd34d;margin-top:4px">'+esc(exp.warnings.join(' · '))+'</div>':'';
      E.policyNote.innerHTML=(m.saved?'✓ Política salva. ':'')+'Efetiva agora: '+esc(effBits)+' · cadeia: '+esc(chainTxt)+(chips?'<div style="margin-top:6px">'+chips+'</div>':'')+warnings; }
    function collectAdaptivePolicy(){ if(!adaptivePolicyDoc)return null; let extra; try{ extra=JSON.parse(E.setPolicyOverrides.value||'{}'); }catch(e){ toast('JSON de políticas avançadas inválido.'); E.setPolicyOverrides.focus(); return null; }
      const global=Object.assign({},adaptivePolicyDoc.global||{}); global.memory=Object.assign({},global.memory||{}, {writeTarget:E.setPolicyMemoryTarget.value,allowPersonalContext:E.setPolicyPersonalContext.checked}); global.autonomy=Object.assign({},global.autonomy||{}, {mode:E.setPolicyMode.value,requireApprovalAboveRisk:E.setPolicyRisk.value,allowQueueAutoplay:E.setPolicyAutoplay.checked,allowBackgroundTurns:E.setPolicyBackground.checked}); global.budget=Object.assign({},global.budget||{}, {unknownEstimate:E.setPolicyUnknown.value}); global.write=Object.assign({},global.write||{}, {allowRepoWrites:E.setPolicyRepoWrites.checked,requireDiffPreview:E.setPolicyDiff.checked}); global.updatedAt=Date.now();
      if(E.setPolicyCost.value.trim()==='') delete global.budget.maxCostUsd; else global.budget.maxCostUsd=Number(E.setPolicyCost.value);
      if(E.setPolicyTokens.value.trim()==='') delete global.budget.maxTokens; else global.budget.maxTokens=Number(E.setPolicyTokens.value);
      return {schemaVersion:1,global,projects:Array.isArray(extra.projects)?extra.projects:[],sessions:Array.isArray(extra.sessions)?extra.sessions:[],tasks:Array.isArray(extra.tasks)?extra.tasks:[]}; }
    function policyFromVisibleControls(scope){ const now=Date.now(), mem=(adaptivePolicyDoc&&adaptivePolicyDoc.global&&adaptivePolicyDoc.global.memory)||{}, base={schemaVersion:1,scope,id:scope+'-'+now,label:scope==='project'?'Pasta atual':'Sessão atual',memory:Object.assign({},mem,{writeTarget:E.setPolicyMemoryTarget.value,allowPersonalContext:E.setPolicyPersonalContext.checked}),autonomy:{mode:E.setPolicyMode.value,requireApprovalAboveRisk:E.setPolicyRisk.value,allowQueueAutoplay:E.setPolicyAutoplay.checked,allowBackgroundTurns:E.setPolicyBackground.checked},budget:{unknownEstimate:E.setPolicyUnknown.value},write:{allowRepoWrites:E.setPolicyRepoWrites.checked,requireDiffPreview:E.setPolicyDiff.checked},updatedAt:now};
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
    if(E.pushRefresh) E.pushRefresh.onclick=requestPushStatus;
    if(E.pushTest) E.pushTest.onclick=()=>{ if(E.pushTest.disabled)return; E.pushTest.disabled=true; E.pushTest.textContent='Enviando…'; tx({t:'push_test'}); setTimeout(()=>{ if(E.pushTest){ E.pushTest.disabled=false; E.pushTest.textContent='Enviar teste'; } },3500); };
    E.updCheck.onclick=()=>{ E.updStatus.textContent='Verificando…'; tx({t:'update_check'}); };
    let updArmed=0;
    E.updApply.onclick=()=>{ const now=Date.now(); if(now-updArmed<4000){ updArmed=0; E.updApply.textContent='Atualizar'; E.updStatus.textContent='Atualizando… (o Hub vai reiniciar)'; E.updActions.classList.add('hidden'); tx({t:'update_apply',allMachines:E.updAll.checked}); }
      else { updArmed=now; E.updApply.textContent='Confirmar?'; setTimeout(()=>{ if(Date.now()-updArmed>=4000) E.updApply.textContent='Atualizar'; },4200); } };
    E.setEnroll.onclick=()=>enrollFlow();
    async function settingsSaveGeneral(btn){
      const isOwner=authUser&&authUser.role==='owner';
      if(isOwner){ const numeric=[E.setExecRetention,E.setExecMaxEvents,E.setExecConcurrency,E.setExecDepth]; if(adaptivePolicyDoc) numeric.push(E.setPolicyCost,E.setPolicyTokens); const invalid=numeric.find(x=>!x.checkValidity()); if(invalid){ invalid.reportValidity(); return; }
        tx({t:'set_execution_cfg',enabled:E.setExecEnabled.checked,retentionDays:+E.setExecRetention.value,maxEvents:+E.setExecMaxEvents.value,maxConcurrency:+E.setExecConcurrency.value,maxDepth:+E.setExecDepth.value,defaultWrite:E.setExecDefaultWrite.checked,worktreeRoot:(E.setExecWorktree.value||'').trim()}); }
      if(isOwner&&adaptivePolicyDoc){ const doc=collectAdaptivePolicy(); if(!doc)return; tx({t:'set_adaptive_policy',doc,sessionId:currentSession}); }
      if(E.setGate.checked && !speakers.length){ addErr('Cadastre sua voz antes de exigir voz cadastrada (senão o modo voz fica bloqueado).'); E.setGate.checked=false; }
      Object.assign(cfg,{agent:E.setAgent.value,model:E.setModel.value,effort:E.setEffort.value,voice:E.setVoice.checked,
      continue:E.setContinue.checked,continueSec:+E.setContinueSec.value||30,silenceSec:(E.setSilenceSec?(+E.setSilenceSec.value||1.8):1.8),wake:E.setWake.checked,noise:E.setNoise.checked,voiceGate:E.setGate.checked,bioLock:!!(E.setBioLock&&E.setBioLock.checked),slashMenu:!E.setSlash||E.setSlash.checked});
      if(!slashOn()) closeTrig();
      saveCfg(); speak=cfg.voice; setSpeakBtn(); tx({t:'wake',enabled:cfg.wake}); tx({t:'voicecfg',gate:cfg.voiceGate});
      if(window.__jarvisNative){ if(cfg.wake&&window.__jarvisNative.wakeStart){ const ok=await window.__jarvisNative.wakeStart(); if(ok===false) toast('Wake word indisponível neste aparelho. Verifique permissão de microfone e reinstale o APK atualizado.'); } else if(!cfg.wake){ window.__jarvisNative.wakeStop&&window.__jarvisNative.wakeStop(); } }
      const pp=pushPrefs(); cfg.pushEvents=pp.events; cfg.pushMode=pp.mode; cfg.pushEvery=pp.everyMin;
      const wantPush=E.setPush.checked;
      try{
        if(wantPush&&!cfg.push){ const ok=await enablePush(); cfg.push=!!ok; if(E.setPush)E.setPush.checked=!!ok; }
        else if(!wantPush&&cfg.push){ await disablePush(); cfg.push=false; }
        // Ja inscrito: so atualiza as prefs — re-inscrever trocaria o endpoint a toa.
        else if(wantPush&&cfg.push){ await updatePushPrefs(pp); }
      }catch(e){ cfg.push=false; if(E.setPush)E.setPush.checked=false; toast('Falha ao salvar notificações: '+(e&&e.message?e.message:e)); }
      saveCfg(); renderPushCfg();
      // Salvar NÃO fecha: mexer em várias abas de configuração exigia reabrir tudo a cada ajuste.
      // O feedback vira o próprio botão (e o toast), então continua claro que gravou.
      const label=btn&&btn.textContent; if(btn){ btn.textContent='Salvo ✓'; setTimeout(()=>{ if(btn.isConnected) btn.textContent=label||'Salvar'; },1600); } toast('Configurações salvas.'); }
    // Cada aba salvável tem o SEU botão Salvar (Opção A): sem rodapé duplicando Salvar/Fechar. O save
    // é o mesmo (persiste os campos gerais de uma vez); fechar é só o X do cabeçalho. Painéis pessoais,
    // framework, rota, dispositivos e atualização têm as próprias ações/auto-save.
    function settingsInstallPanelSaves(){ ['geral','voz','notif','automacao'].forEach(name=>{ const panel=E.settings&&E.settings.querySelector('.spanel[data-panel="'+name+'"]'); if(!panel||panel.querySelector('.settings-panel-actions'))return; const wrap=document.createElement('div'); wrap.className='settings-panel-actions'; const btn=document.createElement('button'); btn.type='button'; btn.className='set-save'; btn.textContent='Salvar'; btn.onclick=()=>settingsSaveGeneral(btn); wrap.appendChild(btn); panel.appendChild(wrap); }); }
    settingsInstallPanelSaves();
    if(E.setX) E.setX.onclick=()=>{ E.settings.classList.add('hidden'); restoreFocusAfterModal(E.settings); }; // fechar (único), no canto do card

    // ---------- generic dialog (substitui alert/confirm/prompt nativos) ----------
    let dlgResolve=null;
    function dialog({title,input=false,placeholder='',value='',okText='OK',cancelText='Cancelar',danger=false}){
      return new Promise(res=>{ dlgResolve=res; E.dlgTitle.textContent=title; E.dlgInput.classList.toggle('hidden',!input); E.dlgInput.value=value; E.dlgInput.placeholder=placeholder;
        E.dlgOk.textContent=okText; E.dlgCancel.textContent=cancelText||''; E.dlgCancel.classList.toggle('hidden',cancelText==null); E.dlgOk.classList.toggle('danger',!!danger); E.dlg.classList.remove('hidden');
        if(input) setTimeout(()=>{E.dlgInput.focus();E.dlgInput.select();},30); }); }
    function dlgClose(val){ E.dlg.classList.add('hidden'); const r=dlgResolve; dlgResolve=null; if(r) r(val); }
    E.dlgOk.onclick=()=>dlgClose(E.dlgInput.classList.contains('hidden')?true:E.dlgInput.value.trim());
    E.dlgCancel.onclick=()=>dlgClose(null);
    E.dlgInput.onkeydown=(e)=>{ if(e.key==='Enter'){e.preventDefault();E.dlgOk.click();} else if(e.key==='Escape'){e.preventDefault();E.dlgCancel.click();} };
    // ---------- info completa da sessão (título do chat) ----------
    // O header mostra até 2 linhas; o title nativo preserva o nome completo no hover/toque longo.
    function sessionInfoLines(){ const L=[]; const t=(E.title.textContent||'').trim();
      if(t && t!=='—' && t!=='Jarvis') L.push(['Conversa', t]);
      if(currentSession) L.push(['ID', currentSession]);
      const runner=currentSessionRunner||selectedRunner(), mac=machines.find(m=>m.id===runner)||machines.find(m=>m.id===currentMachine);
      if(mac && machines.length>1) L.push(['Máquina', mac.label]);
      else if(runner && runner!=='local') L.push(['Máquina', runner]);
      if(currentAgent) L.push(['Agente', currentAgent]);
      if(curCwd) L.push(['Pasta', curCwd]);
      return L; }
    function refreshTitleInfo(){ const L=sessionInfoLines(), full=L.map(([k,v])=>k+': '+v).join('\n'); E.title.title=full; E.title.setAttribute('aria-label',full||E.title.textContent||''); }
    async function copySessionId(){ if(!currentSession)return; const value=currentSession; try{ if(!navigator.clipboard)throw new Error('clipboard indisponível'); await navigator.clipboard.writeText(value); toast('ID da sessão copiado.'); }catch(e){ await dialog({title:'ID da sessão:\n'+value,okText:'Fechar',cancelText:null}); } }
    // Painel rico da sessão: em vez de um blob de texto no dialog genérico, um card com cabeçalho
    // (avatar + título + agente·modelo) e linhas ícone/rótulo/valor, badges de estado e ID em mono.
    function relTimeLabel(ts){ if(!ts)return ''; const d=Math.max(0,Date.now()-ts), min=60000,h=3600000,day=86400000;
      if(d<min)return 'agora mesmo'; if(d<h)return 'há '+Math.floor(d/min)+' min'; if(d<day)return 'há '+Math.floor(d/h)+' h';
      const dd=Math.floor(d/day); if(dd<7)return 'há '+dd+' dia'+(dd>1?'s':''); return new Date(ts).toLocaleDateString('pt-BR'); }
    function sessionInfoRows(){ const rows=[], add=(ic,k,v,extra)=>{ if(v!=null&&v!=='') rows.push(Object.assign({ic,k,v},extra||{})); };
      const cap=(caps||[]).find(c=>c.name===currentAgent); add('🤖','Agente',(cap&&(cap.label||cap.name))||currentAgent);
      const model=curModel||sessDeclModel; add('🧠','Modelo', model?modelLabel(currentAgent,model):'Automático');
      const eff=curEffort||sessDeclEffort; if(eff) add('🎚️','Esforço', effLabel(eff));
      const runner=currentSessionRunner||selectedRunner(); if((machines&&machines.length>1)||(runner&&runner!=='local')) add('🖥️','Máquina', machineLabel(runner));
      if(curCwd) add('📁','Pasta', projectLabelOf(curCwd), {sub:curCwd});
      const s=(sessions||[]).find(x=>x.id===currentSession); if(s&&s.updatedAt) add('🕑','Atualizada', relTimeLabel(s.updatedAt), {sub:new Date(s.updatedAt).toLocaleString('pt-BR')});
      const badges=[]; if(curNative)badges.push({t:'nativa'}); if(currentSession)badges.push({t:curStarted?'em andamento':'nova',soft:true}); if(badges.length) add('⚑','Estado', badges);
      if(currentSession) add('🔑','ID', currentSession, {mono:true});
      return rows; }
    function openSessionInfo(){ const title=(E.title.textContent||'Sessão').trim()||'Sessão';
      E.siTitle.textContent=title; E.siAvatar.textContent=(title[0]||'✦').toUpperCase();
      const cap=(caps||[]).find(c=>c.name===currentAgent), model=curModel||sessDeclModel;
      E.siSub.textContent=[(cap&&(cap.label||cap.name))||currentAgent, model?modelLabel(currentAgent,model):'Automático'].filter(Boolean).join(' · ');
      E.siRows.innerHTML=''; sessionInfoRows().forEach(r=>{ const row=document.createElement('div'); row.className='sirow';
        const ic=document.createElement('span'); ic.className='ic'; ic.textContent=r.ic; ic.setAttribute('aria-hidden','true');
        const k=document.createElement('span'); k.className='k'; k.textContent=r.k;
        const v=document.createElement('span'); v.className='v'+(r.mono?' mono':'');
        if(Array.isArray(r.v)){ r.v.forEach(b=>{ const bd=document.createElement('span'); bd.className='sibadge'+(b.soft?' soft':''); bd.textContent=b.t; v.appendChild(bd); }); }
        else { v.appendChild(document.createTextNode(r.v)); if(r.sub){ const sm=document.createElement('small'); sm.textContent=r.sub; v.appendChild(sm); } }
        row.appendChild(ic); row.appendChild(k); row.appendChild(v); E.siRows.appendChild(row); });
      E.siCopy.classList.toggle('hidden',!currentSession); E.sessionInfo.classList.remove('hidden'); }
    function closeSessionInfo(){ E.sessionInfo.classList.add('hidden'); }
    E.title.onclick=openSessionInfo;
    E.siClose.onclick=closeSessionInfo;
    E.siCopy.onclick=()=>copySessionId();
    E.sessionInfo.onclick=(e)=>{ if(e.target===E.sessionInfo) closeSessionInfo(); };
    document.addEventListener('keydown',(e)=>{ if(e.key==='Escape'&&!E.sessionInfo.classList.contains('hidden')){ e.stopPropagation(); closeSessionInfo(); } });
    // ---------- catálogo de vozes (timbre falado): listar + ouvir amostra + escolher (Gap 6) ----------
    let voiceList=[], voiceCur='';
    function voiceId(v){ return typeof v==='string'?v:(v&&v.id)||''; }
    function voiceLabel(v){ return typeof v==='string'?prettyVoice(v):(v&&v.label)||voiceId(v); }
    function voiceDesc(v){ return typeof v==='string'?'Voz local Piper instalada neste computador.':((v&&v.description)||''); }
    function voiceMeta(v){ if(typeof v==='string')return 'Piper local'; const bits=[]; if(v.locale)bits.push(v.locale); if(v.accent)bits.push(v.accent); bits.push(v.local?'local':(v.provider||'cloud')); return bits.filter(Boolean).join(' · '); }
    function voiceAvailable(v){ return typeof v==='string'||v.available!==false; }
    function voiceMatchesLang(v){
      const cur=String(lang||'pt').slice(0,2).toLowerCase();
      if(typeof v==='string'){ const m=/^([a-z]{2})_/i.exec(v||''); return m ? m[1].toLowerCase()===cur : true; }
      const loc=String((v&&v.locale)||'').toLowerCase();
      if(!loc || loc==='multi') return true;            // vozes agnósticas de idioma (multi/sem locale): sempre oferecidas
      return loc===cur || loc.startsWith(cur+'-');
    }
    function prettyVoice(v){ const m=/^([a-z]{2})_([A-Za-z]{2})-([^-]+)-(.+)$/.exec(v||''); if(!m) return v||'';
      const langs={pt:'Português',en:'Inglês',es:'Espanhol',fr:'Francês',de:'Alemão',it:'Italiano',nl:'Holandês'};
      const quals={x_low:'muito básica',low:'básica',medium:'média',high:'alta'};
      return `${langs[m[1]]||m[1].toUpperCase()} (${m[2].toUpperCase()}) · ${m[3]} · ${quals[m[4]]||m[4]}`; }
    function renderVoiceCatalog(){ const c=E.voiceCatalog; if(!c)return; c.innerHTML='';
      c.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(176px,1fr));gap:8px;margin:2px 0 6px';
      const visible=voiceList.filter(voiceMatchesLang);
      if(!voiceList.length){ c.style.display='block'; c.innerHTML='<span class="mut">Nenhuma voz local instalada e nenhum catálogo cloud disponível. Para Piper, baixe uma voz com <code>python -m piper.download_voices</code>.</span>'; return; }
      if(!visible.length){ const names={pt:'Português',en:'English',es:'Español'}; c.style.display='block'; c.innerHTML='<span class="mut">Nenhuma voz disponível para '+(names[lang]||lang)+'. Altere o idioma geral ou instale uma voz Piper desse idioma.</span>'; return; }
      visible.forEach(v=>{ const id=voiceId(v), available=voiceAvailable(v), on=id===voiceCur; const card=document.createElement('button'); card.type='button'; card.className='ghost voicecard'+(on?' on':'')+(available?'':' disabled'); card.disabled=!available;
        card.style.cssText='min-height:76px;display:grid;grid-template-columns:34px 1fr;gap:10px;align-items:center;text-align:left;border-radius:10px;padding:10px;border:1px solid '+(on?'#7c3aed':'var(--line)')+';background:'+(on?'#7c3aed22':'#ffffff08')+';opacity:'+(available?'1':'.55');
        card.title=available?id:'Configure OPENAI_API_KEY para usar esta voz.';
        const play=document.createElement('span'); play.textContent='▷'; play.style.cssText='width:34px;height:34px;display:grid;place-items:center;border-radius:10px;background:#ffffff12;color:var(--text);font-size:18px';
        play.onclick=(e)=>{ e.preventDefault(); e.stopPropagation(); if(available) tx({t:'preview_voice',voice:id}); };
        const body=document.createElement('span'); body.style.cssText='min-width:0;display:block';
        const name=document.createElement('span'); name.style.cssText='display:block;color:var(--text);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'; name.textContent=(on?'✓ ':'')+voiceLabel(v);
        const meta=document.createElement('span'); meta.className='mut'; meta.style.cssText='display:block;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'; meta.textContent=voiceMeta(v)+(available?'':' · requer chave');
        const desc=document.createElement('span'); desc.className='mut'; desc.style.cssText='display:block;font-size:10.8px;line-height:1.25;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden'; desc.textContent=voiceDesc(v);
        body.append(name,meta,desc); card.append(play,body);
        card.onclick=()=>{ if(available&&id!==voiceCur) tx({t:'set_voice',voice:id}); };
        c.appendChild(card); }); }
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
    const workNodes=new Map(), workEvents=new Map(), workTranscriptCursor=new Map(), workCollapsed=new Set(), workAutoCollapsed=new Set(), workConnections=new Map();
    const workTranscriptLoading=new Set();
    let workSelected='', workTab='activity', workFilter='all', workConnected=false, workLoaded=false, workLoadError='', workNextCursor='', workLoadingMore=false, workUnseen=0, workLastFocus=null, workAnnounceT=null;
    const WORK_TERMINAL=new Set(['succeeded','failed','cancelled']);
    const WORK_STATE_LABEL={queued:'Na fila',running:'Em execução',waiting_input:'Precisa de você',succeeded:'Concluído',failed:'Falhou',cancelled:'Cancelado',orphaned:'Órfão',unknown:'Estado desconhecido'};
    const workStateLabel=s=>WORK_STATE_LABEL[s]||'Estado desconhecido';
    // `kind` é do protocolo (inglês) e vira meta visível quando o nó não tem agente/modelo — caso do nó
    // de etapa que agrupa uma rodada dentro do trabalho principal.
    const WORK_KIND_LABEL={turn:'turno',workflow:'fluxo',phase:'etapa',agent:'agente',process:'processo'};
    const workKindLabel=k=>WORK_KIND_LABEL[k]||k||'trabalho';
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
    function workSessionKey(s){ return (s.runnerId||'local')+'\0'+s.id; }
    function workSessionCandidateFor(id,runnerId){ const rid=runnerId||''; return sessions.find(s=>s.id===id&&(!rid||(s.runnerId||'local')===rid))||sessions.find(s=>s.id===id)||null; }
    function workSearchNorm(v){ return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(); }
    function workSessionLabel(id,runnerId){
      const s=workSessionCandidateFor(id,runnerId), n=[...workNodes.values()].find(x=>x.sessionId===id&&(!runnerId||x.runnerId===runnerId));
      return (s&&s.title)||((id===currentSession&&(E.title.textContent||'').trim()&&!['—','Jarvis'].includes((E.title.textContent||'').trim()))?E.title.textContent.trim():'')||(n&&n.title)||id||'Sessão';
    }
    function workSessionSearchText(n){
      const s=workSessionCandidateFor(n.sessionId,n.runnerId);
      return workSearchNorm([n.sessionId,workSessionLabel(n.sessionId,n.runnerId),s&&s.agent,s&&s.cwd,s&&s.machine,machineLabel(n.runnerId),n.agent,n.cwd].filter(Boolean).join(' '));
    }
    function workMatches(n){
      if(E.workMachine.value&&n.runnerId!==E.workMachine.value)return false;
      const sessionQuery=workSearchNorm((E.workSession.value||'').trim());
      if(sessionQuery&&!workSessionSearchText(n).includes(sessionQuery))return false;
      if(E.workAgent.value&&n.agent!==E.workAgent.value)return false;
      if(workFilter==='waiting_input'||workFilter==='running'||workFilter==='queued')return n.state===workFilter&&!n.archivedAt;
      if(workFilter==='completed')return n.state==='succeeded'&&!n.archivedAt;
      if(workFilter==='failed')return (n.state==='failed'||n.state==='orphaned')&&!n.archivedAt;
      return true;
    }
    function workVisibleSet(){ const yes=new Set(); [...workNodes.values()].forEach(n=>{ if(!workMatches(n))return; let cur=n, guard=0; while(cur&&guard++<50){yes.add(cur.executionId);cur=cur.parentExecutionId&&workNodes.get(cur.parentExecutionId);} }); return yes; }
    function workFillSelect(sel,vals,current,label){ const sorted=[...new Set(vals.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b))); sel.innerHTML=''; const all=document.createElement('option'); all.value=''; all.textContent=label; sel.appendChild(all); sorted.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;o.selected=v===current;sel.appendChild(o);}); }
    function workFillSessionSearch(ns){
      const dl=document.getElementById('workSessionList'); if(!dl)return;
      const rows=new Map();
      ns.forEach(n=>{ if(!n||!n.sessionId)return; const key=workSessionKey({id:n.sessionId,runnerId:n.runnerId}); if(!rows.has(key))rows.set(key,{id:n.sessionId,runnerId:n.runnerId,label:workSessionLabel(n.sessionId,n.runnerId)}); });
      dl.innerHTML='';
      [...rows.values()].sort((a,b)=>a.label.localeCompare(b.label)).forEach(s=>{ const o=document.createElement('option'); o.value=s.label; o.label=machineLabel(s.runnerId)+' · '+s.id; dl.appendChild(o); });
    }
    function workUpdateScopes(){ const ns=[...workNodes.values()]; workFillSelect(E.workMachine,ns.map(n=>n.runnerId),E.workMachine.value,'Todas'); workFillSessionSearch(ns); workFillSelect(E.workAgent,ns.map(n=>n.agent),E.workAgent.value,'Todas'); }
    function workRenderBadge(){ const ns=[...workNodes.values()].filter(n=>!n.archivedAt), need=ns.filter(n=>n.state==='waiting_input').length, active=ns.filter(n=>n.state==='running'||n.state==='queued').length, total=need||active;
      E.workBadge.classList.toggle('hidden',!total); E.workBadge.classList.toggle('need',!!need); E.workBadge.textContent=String(total||'');
      E.workBtn.setAttribute('aria-label',need?`Trabalhos, ${need} precisam de você`:active?`Trabalhos, ${active} ativos`:'Trabalhos'); }
    function workSelectedPath(){ const ids=new Set(); let n=workNodes.get(workSelected), guard=0; while(n&&guard++<50){ids.add(n.executionId); n=n.parentExecutionId&&workNodes.get(n.parentExecutionId);} return ids; }
    function workExpandPath(id){ let n=workNodes.get(id), guard=0; while(n&&guard++<50){ if(n.parentExecutionId)workCollapsed.delete(n.parentExecutionId); n=n.parentExecutionId&&workNodes.get(n.parentExecutionId); } }
    function workDefaultCollapse(){ const keep=workSelectedPath(); [...workNodes.values()].forEach(n=>{ if(workAutoCollapsed.has(n.executionId)||keep.has(n.executionId))return; if(workChildren(n.executionId).length){ workCollapsed.add(n.executionId); workAutoCollapsed.add(n.executionId); } }); }
    function workTreeRows(){ const visible=workVisibleSet(), roots=[...workNodes.values()].filter(n=>visible.has(n.executionId)&&(!n.parentExecutionId||!visible.has(n.parentExecutionId))).sort(workSort), out=[];
      const visit=(n,level)=>{ out.push({n,level}); if(!workCollapsed.has(n.executionId)) workChildren(n.executionId).filter(x=>visible.has(x.executionId)).sort(workSort).forEach(x=>visit(x,level+1)); }; roots.forEach(n=>visit(n,1)); return out; }
    function renderWorkTree(preserveFocus){ workDefaultCollapse(); const active=document.activeElement&&document.activeElement.closest&&document.activeElement.closest('.worknode'), focusId=preserveFocus&&active&&active.dataset.id; E.workTree.innerHTML=''; const rows=workTreeRows();
      if(!rows.length){ const loading=!workLoaded&&!workLoadError, offline=!workConnected&&!workLoaded, icon=loading?'◔':workLoadError?'⚠':offline?'⌁':'🫙', title=loading?'Carregando trabalhos…':workLoadError?'Não foi possível carregar':offline?'Sem conexão com o Hub':'Nenhum trabalho nesta visão', detail=workLoadError|| (offline?'Conecte-se novamente para buscar a primeira visão.':'Os trabalhos aparecem aqui quando uma IA delega ou o Jarvis inicia um processo acompanhável.'); E.workTree.innerHTML=`<div class="workempty"><span class="weicon">${icon}</span><b>${esc(title)}</b><span>${esc(detail)}</span></div>`; return; }
      rows.forEach(({n,level})=>{ const kids=workChildren(n.executionId).length, root=!n.parentExecutionId, b=document.createElement('button'); b.type='button'; b.className='worknode'; b.dataset.id=n.executionId; b.dataset.state=n.state||'unknown'; b.setAttribute('role','treeitem'); b.setAttribute('aria-level',String(level)); b.setAttribute('aria-selected',String(n.executionId===workSelected)); if(kids)b.setAttribute('aria-expanded',String(!workCollapsed.has(n.executionId))); b.style.paddingLeft=(8+(level-1)*15)+'px';
        const role=root&&kids?'orquestrador':n.kind==='phase'?'etapa':n.agent, srcTitle=String(n.title||n.summary||n.executionId), displayTitle=root?'Trabalho principal':srcTitle, meta=[role,n.model,n.effort].filter(Boolean).join(' · ')||workKindLabel(n.kind), metaFull=(root&&srcTitle&&srcTitle!==n.executionId)?(meta+' · '+srcTitle):meta, state=(n.archivedAt?'Arquivado · ':'')+workStateLabel(n.state); b.title=root?srcTitle:''; b.innerHTML=`<span class="wbranch" title="${kids?'Expandir/recolher':''}">${kids?(workCollapsed.has(n.executionId)?'▸':'▾'):''}</span><span class="wnmain"><span class="wntitle">${esc(displayTitle)}</span><span class="wnmeta">${esc(metaFull)} · ${workDuration(n)}</span></span><span class="wnstate">${state}</span>`;
        const branch=b.querySelector('.wbranch'); if(kids&&branch)branch.onclick=e=>{ e.stopPropagation(); workCollapsed.has(n.executionId)?workCollapsed.delete(n.executionId):workCollapsed.add(n.executionId); renderWorkTree(true); };
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
      const events=workEvents.get(n.executionId)||[], cap=n.capabilities||{}; E.workCrumb.textContent=workBreadcrumb(n); E.workNodeTitle.textContent=(!n.parentExecutionId)?'Trabalho principal':(n.title||n.executionId); E.workNodeTitle.title=String(n.title||n.executionId); E.workNodeState.textContent=workNodeStatusText(n);
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
    function openWorkNode(id,{fromHash=false}={}){ const n=workNodes.get(id); workSelected=id; workExpandPath(id); workUnseen=0; E.workNew.classList.add('hidden'); E.workPanel.classList.add('show-detail'); renderWorkTree(); renderWorkDetail(); tx({t:'execution_open',executionId:id,limit:500}); if(!fromHash)workSetHash(); }
    function openWorkPanel({fromHash=false}={}){ workLastFocus=document.activeElement; closeFilePanel();E.workPanel.classList.remove('hidden');E.workPanel.setAttribute('aria-hidden','false');closeSide();workConnected=!!(ws&&ws.readyState===1);renderWorkConnection();workUpdateScopes();renderWorkTree();renderWorkDetail();tx({t:'executions_list',scope:'all',limit:500});if(!fromHash&&workSelected)workSetHash();setTimeout(()=>{const f=E.workPanel.querySelector('.worknode[aria-selected="true"]')||E.workClose;f&&f.focus();},20); }
    function closeWorkPanel(clearHash=true){ E.workPanel.classList.add('hidden');E.workPanel.classList.remove('show-detail','max');E.workPanel.setAttribute('aria-hidden','true');E.workMax.textContent='⛶';if(clearHash){workSelected='';workSetHash(true);}if(workLastFocus&&workLastFocus.isConnected)workLastFocus.focus(); }
    function renderWorkConnection(){ const bad=[...workConnections.values()].filter(x=>x!=='online').length; E.workLive.textContent=!workConnected?'offline · última visão':bad?`parcial · ${bad} máquina${bad===1?'':'s'}`:'ao vivo';E.workLive.classList.toggle('offline',!workConnected||!!bad); }
    function workAnnounce(text){ clearTimeout(workAnnounceT); workAnnounceT=setTimeout(()=>{E.workAnnounce.textContent=text;},400); }
    function workApplyEvent(ev){ if(!ev||!ev.executionId)return; let n=workNodes.get(ev.executionId); if(ev.kind==='node_created'&&ev.node){n=ev.node;workNodes.set(n.executionId,n);workMaybeInlineNode(n);}else if(n&&ev.kind==='state_changed'){n=Object.assign({},n,{state:ev.to,summary:ev.reason||n.summary,startedAt:ev.to==='running'&&!n.startedAt?(ev.at||Date.now()):n.startedAt,endedAt:WORK_TERMINAL.has(ev.to)?(ev.at||Date.now()):n.endedAt});workNodes.set(n.executionId,n);}else if(n&&ev.kind==='archived'){n=Object.assign({},n,{archivedAt:ev.archived?(ev.at||Date.now()):undefined});workNodes.set(n.executionId,n);}else if(n&&ev.kind==='usage'&&ev.usage){const scope=ev.scope==='subtree'?'subtree':'self',metrics=Object.assign({},n.metrics||{}),old=Object.assign({},metrics[scope]||{}),next=Object.assign({},old),replace=ev.measure==='cumulative';['inputTokens','cachedInputTokens','outputTokens','costUsd'].forEach(k=>{if(ev.usage[k]!=null)next[k]=replace?workNum(ev.usage[k]):workNum(old[k])+workNum(ev.usage[k]);});if(ev.usage.costKind)next.costKind=ev.usage.costKind;metrics[scope]=next;workNodes.set(n.executionId,Object.assign({},n,{metrics}));}else if(n&&(ev.kind==='tool'||ev.kind==='agent_event')){const a=ev.kind==='agent_event'&&ev.event,usage=a&&a.kind==='usage'&&a.usage,tool=ev.kind==='tool'?ev.tool:a&&a.tool,isStart=tool&&tool.status==='started',metrics=Object.assign({},n.metrics||{}),scope=a&&a.usageScope==='subtree'?'subtree':'self',own=Object.assign({},metrics[scope]||{});if(usage){['inputTokens','cachedInputTokens','outputTokens','costUsd'].forEach(k=>{if(usage[k]!=null)own[k]=workNum(own[k])+workNum(usage[k]);});if(usage.costKind)own.costKind=usage.costKind;}if(isStart)own.toolCalls=workNum(own.toolCalls)+1;if(usage||isStart){metrics[scope]=own;workNodes.set(n.executionId,Object.assign({},n,{metrics}));}}
      if(n)workSyncInlineNode(n);
      if(ev.kind!=='node_created'){const list=workEvents.get(ev.executionId)||[];if(!ev.eventId||!list.some(x=>x.eventId===ev.eventId)){list.push(ev);if(list.length>5000)list.splice(0,list.length-5000);workEvents.set(ev.executionId,list);}}
      workRenderBadge(); workUpdateScopes(); renderWorkTree(true); if(workSelected===ev.executionId&&!E.workPanel.classList.contains('hidden')){const atEnd=E.workDetailBody.scrollHeight-E.workDetailBody.scrollTop-E.workDetailBody.clientHeight<45;if(atEnd){renderWorkDetail();E.workDetailBody.scrollTop=E.workDetailBody.scrollHeight;}else{workUnseen++;E.workNew.textContent=workUnseen+' novo'+(workUnseen===1?' evento':'s eventos');E.workNew.classList.remove('hidden');}} if(ev.kind==='input_requested')workAnnounce('Um trabalho precisa de você.'); }
    function workApplySnapshot(m){ workLoaded=true;workLoadError='';if(m.scope==='all'&&!workLoadingMore){workNodes.clear();workCollapsed.clear();workAutoCollapsed.clear();}workLoadingMore=false;workNextCursor=m.nextCursor||'';E.workMore.classList.toggle('hidden',!workNextCursor);E.workMore.disabled=false;E.workMore.textContent='Mostrar mais';(Array.isArray(m.nodes)?m.nodes:[]).forEach(n=>{if(n&&n.executionId){workNodes.set(n.executionId,n);workSyncInlineNode(n);}});workRenderBadge();workUpdateScopes();renderWorkTree();scheduleAutoPager(maybeAutoMoreWork);const wanted=hashWork();if(wanted&&workNodes.has(wanted)&&workSelected!==wanted){if(E.workPanel.classList.contains('hidden'))openWorkPanel({fromHash:true});openWorkNode(wanted,{fromHash:true});}else if(workSelected&&!workNodes.has(workSelected)){workSelected='';renderWorkDetail();} }
    if(E.designBtn) E.designBtn.onclick=()=>{ E.designPanel.classList.contains('hidden')?openDesign():closeDesign(); };
    if(E.designClose) E.designClose.onclick=()=>closeDesign();
    if(E.designDetect) E.designDetect.onclick=()=>{ ensureDesignWebview(E.designUrl.value||''); detectDesignPreview(); };
    if(E.designOpen) E.designOpen.onclick=()=>{ const u=(E.designUrl&&E.designUrl.value||'').trim(); if(u) window.open(u,'_blank','noopener'); };
    if(E.designGrab) E.designGrab.onclick=()=>grabDesignElement();
    if(E.designSend) E.designSend.onclick=()=>sendDesignFeedback();
    if(E.designClear) E.designClear.onclick=()=>{ designSelections=[]; renderDesignSelections(); designStatus('Pacote limpo.'); };
    if(E.designCancel) E.designCancel.onclick=()=>{ try{ var id=designWCId(); if(id!=null&&window.jarvis.browser) window.jarvis.browser.cancelGrab(id); }catch(e){} designStatus('Seleção cancelada.'); };
    if(E.designUrl) E.designUrl.onchange=()=>ensureDesignWebview(E.designUrl.value||'');
    E.workBtn.onclick=()=>openWorkPanel(); E.workClose.onclick=()=>closeWorkPanel(); E.workBack.onclick=()=>{const prior=workSelected;workSelected='';E.workPanel.classList.remove('show-detail');renderWorkTree();renderWorkDetail();workSetHash(true);const n=prior&&E.workTree.querySelector(`.worknode[data-id="${CSS.escape(prior)}"]`);n&&n.focus();};
    E.workMax.onclick=()=>{const max=E.workPanel.classList.toggle('max');E.workMax.textContent=max?'🗗':'⛶';E.workMax.title=max?'Restaurar':'Maximizar';};
    E.workPanel.querySelectorAll('.workfilters [data-filter]').forEach(b=>b.onclick=()=>{workFilter=b.dataset.filter;E.workPanel.querySelectorAll('.workfilters [data-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderWorkTree();});
    [E.workMachine,E.workAgent].forEach(s=>s.onchange=()=>renderWorkTree());
    E.workSession.oninput=E.workSession.onchange=()=>renderWorkTree();
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
    // Card ÚNICO de progresso do Debate, atualizado em lugar (a IA é one-shot: feedback por IA concluída
    // na rodada, não token-a-token). Fica fixo no rodapé do log e some quando chega `phase:'done'`.
    let debateProgressEl=null, debateProgressId=null;
    // Enquanto um debate roda, o envio do chat é um RECADO para a próxima rodada (interjeição), não um
    // turno. Quem decide é o servidor de qualquer forma — `debateBySession` existe para o composer não
    // mentir: sem bolha otimista, sem "enviando…", e com o placeholder dizendo a verdade.
    // `canSay:false` = o debate entrou na síntese e não há mais rodada para receber recado.
    function debateFrameKey(m){ return sessionStateKey(m.sessionId,frameRunner(m)); }
    function debateLive(sid,runner){ if(!sid)return null; const d=debateBySession[sessionStateKey(sid,runner||sessionRunner())]; return (d&&d.canSay)?d:null; }
    function renderDebateProgress(m){
      if(m.phase==='done'){ if(debateProgressEl){ try{debateProgressEl.remove();}catch(e){} } debateProgressEl=null; debateProgressId=null; return; }
      if(!debateProgressEl || debateProgressId!==m.debateId){ if(debateProgressEl){ try{debateProgressEl.remove();}catch(e){} } debateProgressEl=document.createElement('div'); debateProgressEl.className='msg bot debate-progress'; debateProgressId=m.debateId; }
      const ico=s=> s==='done'?'✓':s==='failed'?'⚠':'⏳';
      const ias=(m.debaters||[]).map(d=>`<span style="white-space:nowrap">${ico(d.state)} ${esc(d.label)}</span>`).join(' &nbsp;·&nbsp; ');
      const phase = m.phase==='judging'?'juiz avaliando…':m.phase==='synthesizing'?'sintetizando resultado…':'debatendo…';
      // Com execução gerenciada o frame traz `rootExecutionId` → botão pra abrir os subagentes/ferramentas
      // ao vivo no painel Trabalhos. Aponta pro TRABALHO PRINCIPAL do debate (as rodadas são etapas dele),
      // não pra rodada da vez: é o mesmo id do começo ao fim, então o link não muda debaixo do usuário.
      const work = m.rootExecutionId ? `<button type="button" class="dbg-work ghost" data-root="${esc(m.rootExecutionId)}" style="border:0;background:none;cursor:pointer;color:var(--accent,#6ea8fe);font-size:12px;padding:0 4px">↗ ver em Trabalhos</button>` : '';
      // Interjeição: enquanto dá para mandar recado, o card diz isso — a alternativa era o usuário
      // descobrir sozinho que o chat mudou de destino. Quantos recados entraram nesta rodada é a
      // prova de que o recado virou prompt, e não um "ok" solto.
      const recados = m.interjected>0 ? `<span style="color:#f5b544">💬 ${m.interjected} recado${m.interjected===1?'':'s'} nesta rodada</span>` : '';
      const convite = m.canSay!==false ? `<span class="mut">💬 escreva no chat para orientar a próxima rodada</span>` : '';
      const rodape = [recados,convite].filter(Boolean).join(' &nbsp;·&nbsp; ');
      debateProgressEl.innerHTML=`<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-weight:600;flex:1;min-width:0">🗣️ Debate — rodada ${m.round||1}/${m.maxRounds||'?'} <span class="mut" style="font-weight:400">· ${phase}</span></span>${work}</div>`+(ias?`<div style="display:flex;gap:6px;flex-wrap:wrap;font-size:12.5px;opacity:.95">${ias}</div>`:'')+(rodape?`<div style="margin-top:4px;font-size:11.5px">${rodape}</div>`:'');
      E.log.appendChild(debateProgressEl); autoScroll();
    }
    // deep-link: preserves both the conversation and the selected work. Old #<sessionId> links stay valid.
    function hashParams(){ const raw=location.hash.slice(1); if(!raw||/^personal-assistant(?:\?|$)/.test(raw))return new URLSearchParams(); if(!raw.includes('=')&&!raw.includes('&')){const p=new URLSearchParams();p.set('session',decodeURIComponent(raw));return p;}return new URLSearchParams(raw); }
    function setHash(id){ const p=new URLSearchParams(); if(id){p.set('session',id);p.set('runner',currentSessionRunner);} if(workSelected&&!E.workPanel.classList.contains('hidden'))p.set('work',workSelected); const h=p.toString(); if(h){if(location.hash!=='#'+h)history.replaceState(null,'','#'+h);}else if(location.hash)history.replaceState(null,'',location.pathname+location.search); }
    const hashSession = () => hashParams().get('session')||'';
    const hashRunner = () => hashParams().get('runner')||'';
    const hashWork = () => hashParams().get('work')||'';
    function applyDeepLink(){if(personalDeepLinkTarget(location.href)){queuePersonalDeepLink(location.href);return;}const h=hashSession(),r=hashRunner()||selectedRunner(),w=hashWork(); if(h&&(h!==currentSession||r!==currentSessionRunner)&&(isNative(h)||sessions.some(s=>s.id===h&&(!hashRunner()||(s.runnerId||selectedRunner())===r))))openSession(h,r);if(w){if(E.workPanel.classList.contains('hidden'))openWorkPanel({fromHash:true});if(workNodes.has(w)&&workSelected!==w)openWorkNode(w,{fromHash:true});}else if(!E.workPanel.classList.contains('hidden'))closeWorkPanel(false); }
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
    function postAuth(){ tx({t:'wake',enabled:cfg.wake}); tx({t:'executions_list',scope:'all',limit:500}); requestPersonalState(); if(authUser&&authUser.role==='owner')tx({t:'adaptive_approvals'});
      // Socket NOVO: o Hub roteia toda conexão recém-autenticada para LOCAL (clientRunner é por socket).
      // routedMachine é o espelho desse estado no cliente; se ele não voltar pra 'local' aqui, o
      // openSession() acha que já está roteado pra máquina certa, NÃO reenvia {t:'runner'}, e todo
      // open/send seguinte vai parar na máquina errada (sessão remota executada no Hub → erro).
      routedMachine='local';
      // 'all' é uma VISÃO sintética, não um runner: não existe machines[].id==='all'. Marcá-la como
      // "máquina a restaurar" fazia o handler de 'machines' cair no else e derrubar a vista pra 'local',
      // apagando a preferência salva — com a lista agregada (as duas máquinas) ainda na tela. Era a
      // origem da mistura Desktop⇄Notebook depois de cada reconexão. Ver o inicializador de restoringMachine.
      if(currentMachine!=='local'&&currentMachine!=='all'){ restoringMachine=true; }
      else if(currentSession) openSession(currentSession,currentSessionRunner);
      if(cfg.push) enablePush(); requestCommands(); if(hashWork())openWorkPanel({fromHash:true}); }
    function enter(){ if(enteredConn)return; enteredConn=true; authed=true; hideGate(); if((location.hash||'').indexOf('invite=')>=0){ try{ history.replaceState(null,'','/'); }catch(e){} } postAuth(); initializePersonalNativeBridge();setTimeout(()=>{if(!consumePendingPersonalDeepLink())applyDeepLink();},0); if(window.__jarvisNative){ if(window.__jarvisNative.reregister&&cfg.push) window.__jarvisNative.reregister(); if(window.__jarvisNative.wakeStart&&cfg.wake) window.__jarvisNative.wakeStart(); } }

    function connect(){ ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host);
      ws.onopen=()=>{ E.dot.classList.add('on'); workConnected=true; renderWorkConnection(); enteredConn=false; if(authToken) tx({t:'auth',token:authToken}); else tx({t:'authinfo'}); }; // autentica antes de tudo
      ws.onclose=()=>{ E.dot.classList.remove('on'); workConnected=false; renderWorkConnection(); scheduleReconnect(); };
      ws.onmessage=(e)=>{ const m=JSON.parse(e.data);
        // Auto-recarregar quando a UI muda no servidor: guarda a 1ª versão recebida (a do HTML que
        // esta pagina carregou); se depois chegar outra, o arquivo mudou -> esta pagina esta velha.
        // Espera o turno atual terminar pra nao recarregar no meio de uma resposta.
        if(m.t==='version'){ if(m.contractVersion!==1){ addErr(`Cliente incompatível com o contrato de eventos ${m.contractVersion}; recarregue a página.`); E.sendBtn.disabled=true; return; } if(myVer==null){ myVer=m.v; } else if(m.v!==myVer){ needReload=true; maybeReload(); } return; }
        if(handlePersonalFrame(m)) return;
        if(m.t==='authinfo'){ showGate(m.claimed); }
        else if(m.t==='authed'){ if(m.token){ authToken=m.token; localStorage.setItem('jarvis_token',authToken); } authUser=m.user||authUser; updateOwnerUI(); enter(); if(authUser&&authUser.role==='owner') tx({t:'background_jobs'}); }
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
        else if(m.t==='framework_cfg'){ fwArrived(); if(m.preference&&E.setFwPref)E.setFwPref.value=m.preference; if(typeof m.autoStartFlows==='boolean'&&E.setFwAutoFlow)E.setFwAutoFlow.checked=m.autoStartFlows; if(typeof m.applyInstructions==='boolean'&&E.setFwApplyInstr)E.setFwApplyInstr.checked=m.applyInstructions; if(typeof m.version==='number')E.fwVersion.textContent='Versão atual: '+m.version;
          if(m.machines){ fwMachineStatus={}; m.machines.forEach(mc=>{ fwMachineStatus[mc.runnerId]={label:mc.label,state:mc.local?'fonte':((mc.protocolVersion||1)<7?'needs_update':mc.queued?'queued':mc.online?'pronta':'offline')}; }); renderFwStatus(); } }
        else if(m.t==='framework_file'){ fwArrived(); fwShowFile(m.path||'', m.content||''); if(fwPendingJump&&fwPendingJump.path===(m.path||'')) fwJumpToLine(fwPendingJump.line,fwPendingJump.msg); fwPendingJump=null; }
        else if(m.t==='framework_saved'){ fwArrived(); if(m.ok){ tx({t:'framework_cfg'}); tx({t:'framework_inventory'}); fwLog('✓ '+(m.deleted?(m.folder?'pasta excluída':'excluído'):'salvo')+' '+esc(m.path||'')+(m.folder?(' ('+((m.removed||[]).length)+' arquivo(s))'):''),'#4ade80');
            if(m.folder){ toast('Pasta excluída ('+((m.removed||[]).length)+' arquivo(s))'); if(fwEditPath&&String(fwEditPath).startsWith(String(m.path||'')+'/')) fwCloseEdit(true); }
            else if(m.deleted){ fwCloseEdit(true); toast('Arquivo excluído'); }
            else { if(E.fwEditModal&&!E.fwEditModal.classList.contains('hidden')){ fwEditMode='edit'; fwEditPath=m.path||fwEditPath; fwEditOrig=fwSavingContent; if(E.fwEditPathRow)E.fwEditPathRow.style.display='none'; if(E.fwEditTitle)E.fwEditTitle.textContent=fwEditPath; if(E.fwEditDelete)E.fwEditDelete.style.display=''; fwSyncDirty(); } if(E.fwEditSave)E.fwEditSave.disabled=false; toast('Arquivo salvo'); } }
          else { if(E.fwEditSave)E.fwEditSave.disabled=false; fwLog('✖ '+esc(m.error||'falha ao salvar'),'#f87171'); toast('Erro: '+(m.error||'falha')); } }
        else if(m.t==='framework_imported'){ fwArrived(); if(m.ok){ tx({t:'framework_cfg'}); tx({t:'framework_inventory'}); fwLog('✓ importado desta máquina: '+esc((m.imported||[]).join(', ')||'nada novo'),'#4ade80'); toast('Importado: '+((m.imported||[]).join(', ')||'nada novo')); } else { fwLog('✖ '+esc(m.error||'falha'),'#f87171'); toast('Erro: '+(m.error||'falha')); } }
        else if(m.t==='framework_seeded'){ fwArrived(); if(m.ok){ tx({t:'framework_cfg'}); tx({t:'framework_inventory'}); fwLog('✓ pacote base: '+((m.imported||[]).length)+' instalado(s), '+((m.skipped||[]).length)+' preservado(s)','#4ade80'); toast(`Pacote base: ${(m.imported||[]).length} instalado(s).`); } else { fwLog('✖ '+esc(m.error||'falha'),'#f87171'); toast('Erro: '+(m.error||'falha')); } }
        else if(m.t==='framework_inventory'){ fwArrived(); fwInvCache=m; if(fwInvTimer){clearTimeout(fwInvTimer);fwInvTimer=null;} renderFwInventory(m.inventory,m.scan,m.validation); renderFwSources(m.sources); if(typeof m.version==='number')E.fwVersion.textContent='Versão atual: '+m.version; const n=((m.inventory&&m.inventory.files)||[]).length; fwLog('inventário: '+n+' arquivo(s) · seg. '+(((m.scan&&m.scan.counts)||{}).high||0)+' alto(s)'); }
        else if(m.t==='framework_import_preview'){ fwArrived(); if(m.ok){ renderFwPreview(m.token,m.source||{},m.preview||{},!!m.isUpdate); const sc=((m.preview&&m.preview.scan&&m.preview.scan.counts)||{}); fwLog('prévia pronta: '+((m.preview&&m.preview.fileCount)||0)+' arquivo(s), '+(sc.high||0)+' alto(s)'+((sc.high)?' — <b style="color:#f87171">bloqueado até override</b>':''),(sc.high?'#f5b544':null)); } else { fwLog('✖ importar: '+esc(m.error||'falha'),'#f87171'); toast('Importar: '+(m.error||'falha')); } }
        else if(m.t==='framework_update'){ fwArrived(); if(m.ok){ if(m.hasUpdate){ renderFwPreview(m.token,m.source||{},m.preview||{},true); fwLog('atualização disponível — revise a prévia','#f5b544'); toast('Atualização disponível'); } else { fwLog('✓ já está atualizado','#4ade80'); toast('Já está atualizado'); } } else { fwLog('✖ atualização: '+esc(m.error||'falha'),'#f87171'); toast('Atualização: '+(m.error||'falha')); } }
        else if(m.t==='framework_import_applied'){ fwArrived(); if(m.ok){ closeFwPreview(); tx({t:'framework_cfg'}); tx({t:'framework_inventory'}); tx({t:'framework_updates'}); if(fwCatLoaded) tx({t:'framework_native_catalog'}); fwLog('✓ aplicado: '+((m.written||[]).length)+' escrito(s)'+((m.skippedExisting&&m.skippedExisting.length)?', '+m.skippedExisting.length+' mantido(s)':'')+(m.forced?' (override)':''),'#4ade80'); toast('Aplicado'); } else { if(E.fwPreviewApply)E.fwPreviewApply.disabled=false; fwLog('✖ aplicar: '+esc(m.error||'falha'),'#f87171'); toast('Aplicar: '+(m.error||'falha')); } }
        else if(m.t==='framework_source_removed'){ fwArrived(); tx({t:'framework_inventory'}); fwLog(m.ok?'✓ fonte removida':'fonte não encontrada',m.ok?'#4ade80':null); toast(m.ok?'Fonte removida':'Fonte não encontrada'); }
        else if(m.t==='workflow_list'){ fwArrived(); if(m.ok){ fwWfCache=m; wfDefs=m.workflows||[]; renderWfRun(); renderFwWorkflows(m); fwLog('fluxos: '+((m.workflows||[]).length)+' salvo(s), '+((m.candidates||[]).length)+' skill(s) detectável(is)'); } else { fwLog('✖ fluxos: '+esc(m.error||'falha'),'#f87171'); toast('Fluxos: '+(m.error||'falha')); } }
        else if(m.t==='workflow_detected'){ fwArrived(); if(m.ok){ fwWfDraft=m.definition; renderFwWfDraft(); fwLog(m.detected?('detectados '+m.detected+' passo(s) — revise e salve'):'nenhum passo detectado nessa skill',m.detected?'#4ade80':'#f5b544'); if(!m.detected) toast('Nada detectado nessa skill'); } else { fwLog('✖ detectar: '+esc(m.error||'falha'),'#f87171'); toast('Detectar: '+(m.error||'falha')); } }
        else if(m.t==='workflow_saved'){ fwArrived(); if(m.ok){ fwWfDraft=null; tx({t:'workflow_list'}); tx({t:'framework_inventory'}); fwLog('✓ fluxo salvo: '+esc(m.id)+' ('+m.steps+' passo(s))','#4ade80'); toast('Fluxo salvo — publique para valer nas outras máquinas'); } else { fwLog('✖ salvar fluxo: '+esc(m.error||'falha'),'#f87171'); toast('Salvar: '+(m.error||'falha')); } }
        else if(m.t==='framework_native_catalog'){ fwArrived(); if(m.ok){ renderFwCatalog(m.entries); fwLog('catálogo: '+((m.entries||[]).length)+' skill(s)/comando(s) instalado(s)'); } else { fwLog('✖ catálogo: '+esc(m.error||'falha'),'#f87171'); toast('Catálogo: '+(m.error||'falha')); } }
        else if(m.t==='framework_reset'){ fwArrived(); if(m.ok){ fwInvCache=null; tx({t:'framework_inventory'}); tx({t:'workflow_list'}); fwLog('✓ framework limpo: '+m.removed+' arquivo(s) removido(s) e fontes zeradas','#4ade80'); toast('Framework limpo — importe o nativo e o framework de novo'); } else { fwLog('✖ limpar: '+esc(m.error||'falha'),'#f87171'); toast('Limpar: '+(m.error||'falha')); } }
        else if(m.t==='framework_pack_template'){ fwArrived(); if(m.ok){ fwDownloadTemplate(m); } else { fwLog('✖ modelo: '+esc(m.error||'falha'),'#f87171'); toast('Modelo: '+(m.error||'falha')); } }
        else if(m.t==='framework_updates'){ renderFwUpdates(m.alerts); if((m.alerts||[]).length) fwLog('🔔 '+m.alerts.length+' atualização(ões) disponível(is)','#f5b544'); }
        else if(m.t==='framework_import_diff'){ fwArrived(); if(m.ok){ fwShowDiff(m); } else { fwLog('✖ diferenças: '+esc(m.error||'falha'),'#f87171'); toast('Diferenças: '+(m.error||'falha')); } }
        else if(m.t==='fallback_cfg'){ renderFallback(m); if(m.saved)toast('IA secundária salva'); }
        else if(m.t==='log_cfg'){ renderLog(m); if(m.saved)toast('Logs salvos'); }
        else if(m.t==='notice'){ if(m.message)toast(m.message); if(E.fallbackSettings&&!E.fallbackSettings.classList.contains('hidden'))tx({t:'fallback_cfg'}); }
        else if(m.t==='background_jobs'){ renderBgJobs(m.jobs); }
        // Só run ATIVO vira acompanhamento na tela. O servidor devolve o run atualizado também ao
        // concluir/abandonar — aceitá-lo de olhos fechados deixava a faixa mostrando um fluxo morto até
        // chegar o `workflow_runs` seguinte, que é justamente quem fazia a limpeza por acidente.
        else if(m.t==='workflow_run'){ if(!m.sessionId||m.sessionId===currentSession){ wfRun=(m.run&&m.run.status==='active')?m.run:null; renderWfRun(); if(m.reused) toast('Já havia um acompanhamento para essa tarefa — sessão vinculada.'); } }
        // Multi-tarefa: a lista atualiza o run em foco pelos DADOS, mas não rouba o foco — quem troca
        // o foco é o frame workflow_run (que o servidor emite ao focar/iniciar).
        else if(m.t==='workflow_runs'){ wfRunsAll=m.runs||[]; if(currentSession){ if(wfRun){ const upd=wfRunsAll.find(r=>r.runId===wfRun.runId); if(upd) wfRun=upd.status==='active'?upd:null; } if(!wfRun){ const mine=wfSessionRuns()[0]; if(mine) wfRun=mine; } renderWfRun(); } }
        else if(m.t==='task_binding'){ if(m.sessionId===currentSession) wfTaskBinding=m.binding||null; }
        else if(m.t==='task_local_list'){ if(m.sessionId===currentSession){ wfLocalFiles=m.files||[]; wfLocalDir=m.dir||'docs/features'; if(wfLocalShow){ closePop(); togglePop(E.wfStepBtn,buildWfStepPop); } } }
        else if(m.t==='task_meta'){ wfTaskMeta[wfMetaKey({tracker:m.tracker,key:m.key})]=m.meta||null; renderWfRun(); }
        else if(m.t==='task_connections'){ wfConnections=m.connections||[]; wfProviders=m.providers||[]; if(wfPopIsOpen()){ closePop(); togglePop(E.wfStepBtn,buildWfStepPop); } }
        else if(m.t==='task_search_results'){ wfSearchResults=m; if(wfPopIsOpen()){ closePop(); togglePop(E.wfStepBtn,buildWfStepPop); } }
        else if(m.t==='task_create_pending'){ toast('Criação aguardando sua aprovação: '+(m.preview||'')); }
        else if(m.t==='task_create_result'){ toast(m.ok?('Tarefa criada: '+(m.key||'')):('Criar tarefa: '+(m.error||'falhou'))); }
        else if(m.t==='framework_status'){ fwArrived(); if(m.error){ E.fwStatus.textContent=''; fwLog('✖ publicar: '+esc(m.error),'#f87171'); toast('Publicar: '+m.error); return; }
          if(Array.isArray(m.results)){ m.results.forEach(r=>{ fwMachineStatus[r.runnerId]={label:r.label||r.runnerId,state:r.state}; }); if(typeof m.version==='number')E.fwVersion.textContent='Versão atual: '+m.version; renderFwStatus(); tx({t:'framework_inventory'}); fwLog('✓ publicado v'+m.version+' — '+m.results.map(r=>esc(r.label||r.runnerId)+': '+esc(fwStateLabel(r.state))).join(' · '),'#4ade80'); }
          else if(m.runnerId){ fwMachineStatus[m.runnerId]={label:m.machine||m.runnerId,state:m.state}; renderFwStatus(); fwLog(esc(m.machine||m.runnerId)+': '+esc(fwStateLabel(m.state))); } }
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
        else if(m.t==='council_started'){ toast('Conselho em andamento em Trabalhos.'); if(m.rootExecutionId){ workSelected=m.rootExecutionId; tx({t:'executions_list',scope:'all',rootExecutionId:m.rootExecutionId,runnerId:m.runnerId,limit:500}); } }
        else if(m.t==='tournament_started'){ const lbl=m.mode==='review'?'Revisão paralela':m.mode==='audit'?'Auditoria':'Benchmark'; toast(lbl+' em andamento em Trabalhos.'); if(m.rootExecutionId){ workSelected=m.rootExecutionId; tx({t:'executions_list',scope:'all',rootExecutionId:m.rootExecutionId,runnerId:m.runnerId,limit:500}); } }
        else if(m.t==='debate_started'){ debateBySession[debateFrameKey(m)]={debateId:m.debateId,round:1,maxRounds:m.maxRounds,phase:'debating',canSay:true}; refreshComposer();
          toast('Debate iniciado ('+((m.debaters||[]).length)+' IAs, até '+(m.maxRounds||'?')+' rodadas) — as rodadas aparecem na conversa, e o que você escrever entra na próxima rodada.'); }
        // O estado do debate é atualizado SEMPRE, mesmo com a sessão em segundo plano: o card é só o
        // desenho, mas o roteamento do composer depende de saber que ela tem debate vivo ao voltar.
        else if(m.t==='debate_progress'){
          const key=debateFrameKey(m);
          if(m.phase==='done') delete debateBySession[key];
          else debateBySession[key]={debateId:m.debateId,round:m.round,maxRounds:m.maxRounds,phase:m.phase,canSay:m.canSay!==false};
          if(currentFrame(m)){ renderDebateProgress(m); refreshComposer(); } }
        // Recado ao debate: confirmado (some o "enviando…" que um cliente desatualizado tenha marcado)
        // ou recusado porque o debate fechou entre o envio e a chegada — aí a mensagem NÃO se perde,
        // vira o turno normal que ela teria sido.
        else if(m.t==='debate_said'){
          const key=debateFrameKey(m);
          if(m.ok){ justSent.delete(key); if(m.msgId) dropOptimisticUser(m.sessionId,frameRunner(m),m.msgId); refreshComposer(); if(currentFrame(m)) toast('💬 '+(m.message||'Recado anotado.')); }
          else { delete debateBySession[key]; refreshComposer(); if(m.text) sendMsgTo(m.sessionId,m.text); else toast('⚠ '+(m.message||'Recado não entregue.')); } }
        else if(m.t==='execution_control_result'||m.t==='execution_input_result'||m.t==='execution_archive_result'){
          const unsupported=Array.isArray(m.unsupportedIds)?m.unsupportedIds.length:0; toast(m.ok?(unsupported?`⚠ Atualizado parcialmente · ${unsupported} sem suporte`:'✓ Trabalho atualizado'):('⚠ '+(m.error||'Não foi possível atualizar o trabalho.')));
          if(m.executionId)tx({t:'execution_open',executionId:m.executionId,limit:500});
        }
        else if(m.t==='execution_error'){ const msg=m.message||m.code||'Falha ao carregar trabalhos'; if(m.executionId)workTranscriptLoading.delete(m.executionId); if(!m.executionId){workLoadError=String(msg);workLoadingMore=false;E.workMore.disabled=false;E.workMore.textContent='Tentar novamente';renderWorkTree();} if(m.executionId===workSelected)E.workDetailBody.insertAdjacentHTML('afterbegin',`<div class="worknotice err">${esc(String(msg))}</div>`); else toast('⚠ '+msg); }
        else if(m.t==='update_status'){ updState=m.status; renderUpdate(); }
        else if(m.t==='session_defaults'){ sdDoc=m.doc||sdDoc; if(m.saved)toast('✅ Padrão de permissão salvo'); syncModelEffort(); }
        else if(m.t==='mode'){ /* server confirmed the session permission mode; picker already reflects it */ }
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
        else if(m.t==='hello'){ caps=m.agents||[]; if(!cfg.agent){cfg.agent=m.default;saveCfg();} if(!currentAgent) currentAgent=cfg.agent||m.default||(caps[0]||{}).name||null; syncModelEffort(); clearLimitBanner(); enter(); tx({t:'get_session_defaults'}); }
        else if(m.t==='agent_catalog'){ caps=m.agents||caps; if(m.default&&!cfg.agent){cfg.agent=m.default;saveCfg();} if(!currentAgent) currentAgent=cfg.agent||m.default||(caps[0]||{}).name||null; syncModelEffort(); if(E.settings&&!E.settings.classList.contains('hidden')&&authUser&&authUser.role==='owner') tx({t:'routines'}); }
        else if(m.t==='models_synced'){ caps=m.agents||caps; if(typeof syncModelEffort==='function') syncModelEffort(); const ch=m.changes||[]; toast(ch.length?('✅ Modelos sincronizados — '+ch.length+' ajuste'+(ch.length>1?'s':'')):'✅ Modelos sincronizados — nada a ajustar'); if(ch.length) syncReport(ch); if(E.settings&&!E.settings.classList.contains('hidden')&&authUser&&authUser.role==='owner') tx({t:'routines'}); }
        else if(m.t==='command_list'){ cmdList=m.commands||[]; cmdListFor=(m.runnerId||routedMachine||currentMachine||'local')+'|'+(m.cwd||curCwd||''); cmdReqPending=false; if(trigOpen()&&trigMode==='cmd') updateTrig(); }
        else if(m.t==='mention_list'){ if(findState&&findState.mode==='finder'){ findFinderRender(m.files||[]); return; } fileList=m.files||[]; if(trigOpen()&&trigMode==='file'){ trigItems=fileList.slice(0,50); trigIdx=trigItems.length?0:-1; renderTrig(); } }
        else if(m.t==='worktree_preview'){ if(pendingPreview){ const f=pendingPreview; pendingPreview=null; f(m.candidates||[]); } }
        else if(m.t==='browser_event'){ if(m.event){ designEvent(m.event.kind||'browser',{url:m.event.url,runnerId:m.runnerId,pageId:m.event.pageId}); } }
        else if(m.t==='machines'){ machines=m.machines||[]; machines.forEach(mm=>{ const u=mm.updatePending;if(!u){const prior=updMach[mm.id];if(prior&&['queued','sent','awaiting_restart'].includes(prior.state)&&mm.online&&!mm.stale)updMach[mm.id]={label:mm.label,state:'verified',why:'reiniciou e versão confirmada'};return;} const state=u.state||'queued';updMach[mm.id]={label:mm.label,state,dirty:state==='blocked',why:state==='blocked'?(u.lastError||'atualização bloqueada'):state==='awaiting_restart'?'preparada — aguardando reconexão':state==='sent'?'solicitação entregue':(mm.online?'aguardando nova tentativa':'offline — atualização guardada')};}); if(currentSession==null){ const ac=availableMachineCaps(); if(!currentAgent||!ac.some(c=>c.name===currentAgent)) currentAgent=(ac[0]||machineCaps()[0]||{}).name||currentAgent; syncModelEffort(); } renderUpdMachines(); renderUpdate(); renderMachines(); updateOfflineBanner(); if(currentMachine==='all') tx({t:'listAll'}); if(settingsPanelOpen('dispositivos')) tx({t:'sec_state'}); if(E.settings&&!E.settings.classList.contains('hidden')&&authUser&&authUser.role==='owner') fillRoutineMachines();
          // restaura a máquina remota selecionada antes do reload (senão volta pro servidor)
          if(restoringMachine){ if(machines.some(x=>x.id===currentMachine)){ tx({t:'runner',runnerId:currentMachine}); } else { restoringMachine=false; currentMachine='local'; try{localStorage.removeItem('jarvis_machine');}catch{} } } }
        else if(m.t==='terminal_opened'){ const rec=ensureTerm(m.terminal,m.runnerId||selectedRunner()); if(rec)toast('⌘ Terminal aberto em '+termMachineLabel(rec.runnerId)); }
        else if(m.t==='terminal_output'){ const rec=termMap[termKey(m.runnerId||selectedRunner(),m.terminalId)]; if(rec&&rec.term)rec.term.write(m.data||''); }
        else if(m.t==='terminal_closed'){ const k=termKey(m.runnerId||selectedRunner(),m.terminalId); if(termMap[k])closeTermLocal(k); }
        else if(m.t==='terminal_list'){ (m.terminals||[]).forEach(ti=>ensureTerm(ti,m.runnerId||selectedRunner())); renderTermTabs(); }
        else if(m.t==='terminal_error'){ const msg=m.message||'erro'; toast('⚠ Terminal: '+msg); const rec=termMap[termKey(m.runnerId||selectedRunner(),m.terminalId)]; if(rec&&rec.term)rec.term.writeln('\r\n[erro] '+msg); else { if(E.termPanel){ E.termPanel.classList.remove('hidden'); E.termPanel.setAttribute('aria-hidden','false'); } setTermEmpty('Terminal não abriu',msg); } }
        else if(m.t==='filecontent'){ showFile(m); }
        else if(m.t==='filediff'){ showDiff(m); }
        else if(m.t==='dirs'){ browsePath=m.path;
          if(treePending.has(m.path)){ const node=treePending.get(m.path); treePending.delete(m.path); renderTreeChildren(node,m); return; }   // Orca #1: resposta pra árvore de arquivos
          if(popMode==='folder'){ const path=document.getElementById('popPath'),list=document.getElementById('popList'),up=document.getElementById('popUp');
          if(path){ path.textContent=m.path; if(up) up.dataset.parent=m.parent||''; list.innerHTML=''; (m.entries||[]).forEach(name=>{ const d=document.createElement('div'); d.textContent='📁 '+name; d.onclick=()=>tx({t:'listdir',runnerId:browseRunner,path:m.path.replace(/[\\/]$/,'')+(m.path.includes('\\')?'\\':'/')+name}); list.appendChild(d); }); } } }
        else if(m.t==='cron_validation'){ if(String(m.cron||'').trim()!==(E.rtCron.value||'').trim())return; cronOk=!!m.ok; E.rtAdd.disabled=!cronOk; E.rtCronHelp.className='cron-help '+(cronOk?'ok':'err'); E.rtCronHelp.textContent=cronOk?('✓ '+m.description+' · '+m.expression+' · fuso '+routineTimezone):('⚠ '+m.error); }
        else if(m.t==='sessions'){
          // visão unificada: só o agregado (runnerId 'all') alimenta a lista; listas de máquina única
          // que chegam por troca de runner (ao abrir) são ignoradas aqui pra não sobrescrever o agregado.
          if(currentMachine==='all'){ if(m.runnerId!=='all') return; } else if(m.runnerId && m.runnerId!==currentMachine) return;
          if(m.runnerId==='all') allViewMachines=Array.isArray(m.machines)?m.machines:[];
          restoringMachine=false; sessions=currentMachine==='all'?mergeOptimisticSessions(m.sessions||[]):dedupeSessionsList(m.sessions||[]); recentDirs=m.recentDirs||recentDirs;
          if(lastBump && Date.now()-lastBump.ts<12000){ const bi=sessions.findIndex(s=>s.id===lastBump.sid&&(currentMachine!=='all'||(s.runnerId||'local')===lastBump.runner)); if(bi>0){ const [bs]=sessions.splice(bi,1); sessions.unshift(bs); } }  // preserva o topo recém-enviado
          renderRecents(); if(!currentSession && !creatingSession && currentMachine!=='all'){
          const exists=(id)=> !!id && sessions.some(s=>s.id===id);
          const last=lastByMachine[currentMachine], h=hashSession();
          const pick = exists(last)?last : (exists(h)?h : (sessions.find(s=>!isNative(s.id))||{}).id);
          if(pick) openSession(pick,currentMachine);
          else if(currentMachine==='local' && !hashSession()) E.newSess.onclick(); } }
        else if(m.t==='history'){
          const historyRunner=m.runnerId||(pendingNewSession&&pendingNewSession.runnerId)||selectedRunner(), historyKey=sessionStateKey(m.sessionId,historyRunner); cacheHist({...m,runnerId:historyRunner});
          // Verdade nova sobre a sessão: esquece o debate que o cliente achava que estava vivo. Se ele
          // ainda estiver, o servidor manda o progresso logo depois deste history e o estado renasce —
          // sem isso, um debate que terminou com a aba fechada deixaria o composer roteando para o nada.
          delete debateBySession[historyKey];
          if(historyRunner!==selectedRunner()&&historyKey!==openingSession)return;
          if(openingSession&&historyKey!==openingSession)return;
          if(currentSession && (m.sessionId!==currentSession||historyRunner!==currentSessionRunner)) return;
          if(creatingSession&&currentMachine==='all'){
            const s=m.session||{}, opt={id:m.sessionId,runnerId:historyRunner,machine:machineLabel(historyRunner),title:s.title||'Nova sessão',agent:s.agent||(pendingNewSession&&pendingNewSession.agent)||currentAgent,cwd:s.cwd||(pendingNewSession&&pendingNewSession.cwd)||'',updatedAt:Date.now(),started:(m.messages||[]).length>0,source:s.native?'native':'managed',writable:s.writable!==false};
            upsertOptimisticSession(opt); scheduleAllRefresh();
          }
          openingSession=null; creatingSession=false; applyHistory(m);
          pendingNewSession=null;
        }
        else if(m.t==='message'){ const runner=frameRunner(m), msg=m.message||{}, sid=msg.sessionId||m.sessionId; if(msg.role==='assistant') clearRestorable(sid,runner); if(currentFrame(m,sid)){ if(msg.role==='assistant'){ clearNativeActivity(); clearPending(); if(strEl){ streamDone(msg.text||'',turnUsage,{sessionId:sid,runner}); onTurnEnd(sid,runner); return; } if(recentlyStreamedAssistant(msg.text||'',sid,runner))return; if(msg.activity&&msg.activity.length)clearLooseActivity(); } if(!(msg.role==='user'&&consumeOptimisticUser(sid,msg))) addMsg(msg); if(msg.role==='user'&&!curStarted){ curStarted=true; renderControls(); } } }
        else if(m.t==='queue'){ const runner=m.runnerId||selectedRunner(); const k=sessionStateKey(m.sessionId,runner); queueBySession[k]=(m.items||[]).map(x=>({text:x.text,atts:x.atts||[],msgId:x.msgId})); if(m.blocked) queueBlockBySession[k]=m.blocked; else delete queueBlockBySession[k]; if(m.sessionId===currentSession&&runner===currentSessionRunner) renderQueue(); }
        else if(m.t==='auto_route'&&currentFrame(m)){ if(m.state==='started'){ status('busy','Escolhendo IA, modelo e esforço…'); }
          else if(m.state==='cancelled'){ status(''); clearPending(); onTurnEnd(m.sessionId,frameRunner(m)); }
          else { const d=m.decision||{}; status(''); if(d.agent)currentAgent=d.agent; sessDeclModel=d.model||null; sessDeclEffort=d.effort||null; lastRouteReason=d.reason||''; syncModelEffort(); if(d.fallback)toast('⚠ Automático: '+(d.reason||'usado o padrão compatível')); } }
        else if(m.t==='asking'){ const k=askStateKey(m.sessionId,m.runnerId); if(m.on) askingSids.add(k); else askingSids.delete(k); if(currentFrame(m)){ if(m.on&&!busy(currentSession)) status('busy','Consolidando o resultado…'); else if(!askActive) status(''); refreshComposer(); } renderRecents(); }
        else if(m.t==='ask'){ askingSids.delete(askStateKey(m.sessionId,m.runnerId)); saveAsk(m.sessionId,m.questions||[],m.runnerId); if(m.sessionId===currentSession&&(m.runnerId||selectedRunner())===currentSessionRunner){ status(''); renderAskCard(m.questions||[],m.runnerId); refreshComposer(); } else { unread.add(sessionStateKey(m.sessionId,m.runnerId)); renderRecents(); } }
        else if(m.t==='ask_cleared'){ askingSids.delete(askStateKey(m.sessionId,m.runnerId)); clearAsk(m.sessionId,m.runnerId); if(currentFrame(m)){ if(askActive){try{askActive.card.remove();}catch(e){} askActive=null;askVoice=false;} status('');refreshComposer(); } }
        else if(m.t==='permission_request'){ if(currentFrame(m)) renderPermissionCard(m); }
        else if(m.t==='permission_resolved'){ if(currentFrame(m)) removePermissionCard(m.id); }
        else if(m.t==='agent_event'){ if(!currentFrame(m))return; const ev=m.event||{};
          if(liveTurnId!==ev.turnId){ liveTurnId=ev.turnId; seenAgentEvents.clear(); }
          if(ev.eventId&&seenAgentEvents.has(ev.eventId))return; if(ev.eventId){seenAgentEvents.add(ev.eventId);if(seenAgentEvents.size>1200)seenAgentEvents.delete(seenAgentEvents.values().next().value);}
          if(ev.kind==='accepted'||ev.kind==='started') streamStartUI(ev.at);
          else if(ev.kind==='thinking') streamThinking(ev.text,ev.parentId,ev.executionId);
          else if(/^tool_/.test(ev.kind)&&ev.tool){ const t=ev.tool; streamTool(t.name,t.summary,t.callId,t.parentId,t.path,t.adds,t.dels,t.rows,t.detail,t.status,t.error,ev.executionId,!!t.background); if(t.path)touchFile(t.path,/Edit$|^Write$/.test(t.name)?(t.name==='Write'?'write':'edit'):'read',t.adds,t.dels); }
          else if(ev.kind==='text_delta'||ev.kind==='text_block'){ clearRestorable(m.sessionId); streamText(ev.text||'',ev.parentId||(ev.tool&&ev.tool.parentId),ev.executionId); }
          else if(ev.kind==='plan') streamTool('Plan',ev.plan&&ev.plan.title||ev.text||'Plano atualizado',null,null,null,0,0,null,null,'completed');
          else if(ev.kind==='usage'){ turnUsage=ev.usage||turnUsage; if(ev.usage){E.usage.textContent=usageSummary(ev.usage);if(ev.usage.contextTokens||ev.usage.inputTokens)lastInputTokens=ev.usage.contextTokens||ev.usage.inputTokens;if(ev.usage.contextWindowTokens)lastContextWindow=ev.usage.contextWindowTokens;if(ev.usage.model)sessDeclModel=ev.usage.model;if(ev.usage.effort)sessDeclEffort=ev.usage.effort;renderControls();updUsagePill();} }
          else if(ev.kind==='completed'){ const runner=frameRunner(m); clearRestorable(m.sessionId,runner); if(typeof m.sessionCost==='number'){sessCost=m.sessionCost;sessUsage=m.sessionUsage||sessUsage;} streamDone(ev.text,turnUsage,{sessionId:m.sessionId,runner}); onTurnEnd(m.sessionId,runner); }
          else if(ev.kind==='cancelled'){ streamCancelled(ev.text); onTurnEnd(m.sessionId,frameRunner(m)); }
          else if(ev.kind==='failed'){ streamErr(ev.text); onTurnEnd(m.sessionId,frameRunner(m)); } }
        else if(m.t==='stream'){ if(!currentFrame(m))return; const ev=m.ev||{};
          if(ev.kind==='start') streamStartUI();
          else if(ev.kind==='thinking') streamThinking(ev.text);
          else if(ev.kind==='tool'){ streamTool(ev.name,ev.summary,ev.toolId,ev.parentId,ev.path,ev.adds,ev.dels,ev.rows,ev.detail,null,null,ev.executionId,!!ev.background); if(ev.path) touchFile(ev.path, /Edit$|^Write$/.test(ev.name)?(ev.name==='Write'?'write':'edit'):'read', ev.adds, ev.dels); }
          else if(ev.kind==='text'){ clearRestorable(m.sessionId); streamText(ev.text||'',ev.parentId,ev.executionId); }
          else if(ev.kind==='done'){ const runner=frameRunner(m); clearRestorable(m.sessionId,runner); if(typeof m.sessionCost==='number'){sessCost=m.sessionCost;sessUsage=m.sessionUsage||sessUsage;} streamDone(ev.text, m.usage,{sessionId:m.sessionId,runner}); onTurnEnd(m.sessionId,runner); }
          else if(ev.kind==='cancelled'){ streamCancelled(); onTurnEnd(m.sessionId,frameRunner(m)); }
          else if(ev.kind==='error'){ streamErr(ev.text||ev.message); onTurnEnd(m.sessionId,frameRunner(m)); } }
        else if(m.t==='activity'){ if(!currentFrame(m))return;
          // espelho ao vivo de uma sessão nativa: o evento já é uma ação CONCLUÍDA (o tail lê o que
          // foi escrito) → tool row completo (done): "Editado", contagem +/-, abrir arquivo, diff.
          if(!activityHasContent(m))return;
          if(m.name==='Thinking'&&isGenericThinking(m.summary||m.name))return;
          markNativeActivity();
          if(m.name==='Thinking'){
            const d=trackLooseActivityEl(thinkingEl(m.summary||m.detail||'Pensando...',true,toolOpts(null,{background:!!m.background})));
            if(pendingEl)E.log.insertBefore(d,pendingEl);else E.log.appendChild(d);
            autoScroll(); return;
          }
          const item={kind:'tool',name:m.name,summary:m.summary||m.name||'',path:m.path,adds:m.adds,dels:m.dels,rows:m.rows,detail:m.detail,background:!!m.background};
          const fk=fileGroupKey(item), rk=repeatToolKey(item), k=fk||rk; let d;
          if(fk&&looseActivityGroups[fk]&&looseActivityGroups[fk].isConnected){ d=markLooseActivityEl(looseActivityGroups[fk]); appendToolGroupItem(d,item,true); looseLastGroupKey=fk; }
          else if(rk&&looseLastGroupKey===rk&&looseActivityGroups[rk]&&looseActivityGroups[rk].isConnected){ d=markLooseActivityEl(looseActivityGroups[rk]); appendRepeatGroupItem(d,item,true); }
          else { d=trackLooseActivityEl(fk?toolGroupEl([item],true,toolOpts(null,item)):(rk?repeatGroupEl([item],true):toolRowEl(m.name,m.summary||m.name||'',m.path,m.adds,m.dels,true,m.rows,m.detail,toolOpts(null,item)))); if(k){looseActivityGroups[k]=d;looseLastGroupKey=k;}else looseLastGroupKey=''; if(pendingEl)E.log.insertBefore(d,pendingEl);else E.log.appendChild(d); }
          if(m.path) touchFile(m.path, /Edit$|^Write$/.test(m.name)?(m.name==='Write'?'write':'edit'):'read', m.adds, m.dels);
          autoScroll(); }
        else if(m.t==='usage'){ if(currentFrame(m)&&m.usage){ E.usage.textContent=usageSummary(m.usage); if(m.usage.contextTokens||m.usage.inputTokens)lastInputTokens=m.usage.contextTokens||m.usage.inputTokens;if(m.usage.contextWindowTokens)lastContextWindow=m.usage.contextWindowTokens;updUsagePill(); } }
        else if(m.t==='usage_info'){ planUsage=m.plan||null; planStatus=m.planStatus||null; planKey=(m.runnerId||'local')+'\0'+(m.agent||''); if(typeof m.total==='number') costTotalAll=m.total; if(popMode==='usage'){ renderPlan(planUsage); const sc=document.getElementById('usessc'); if(sc) sc.innerHTML=sessCostRow(); } }
        else if(m.t==='session'){ if(currentFrame(m) && m.nativeId && !curNative){ curNativeId=m.nativeId; renderNativeChip(); } }
        else if(m.t==='deleted'){ const deleted=Array.isArray(m.ids)?m.ids:[], inCur=deleted.includes(currentSession);
          if(inCur){ currentSession=null; clearQueue(); E.log.innerHTML=''; E.title.textContent='—'; refreshTitleInfo(); curNativeId=''; renderNativeChip(); setHash(''); }
          deleted.forEach(id=>{ const key=sessionStateKey(id,sessionRunner()); if(sessionPrefs[key])delete sessionPrefs[key]; if(sessionRunner()==='local'&&sessionPrefs[id])delete sessionPrefs[id]; }); saveSessionPrefs();
          if(!m.ok) toast(t('tDelFail')); }
        else if(m.t==='tts'){ if(m.for==='ask'){ if(!m.sessionId||currentFrame(m))askVoicePlayAndListen(m.audio); } else if(currentFrame(m)) playTTS(m.audio,!!m.closing); }
        else if(m.t==='ask_choice'){ askVoiceApply(m); }
        else if(m.t==='searchResult'){ clearPending();
          if(m.hits!==undefined){ if(!E.searchModal.classList.contains('hidden') && m.query===E.searchInput.value.trim()) renderHits(E.searchResults,m); }   // filtro literal digitado (ignora resposta obsoleta)
          else if(!E.searchModal.classList.contains('hidden')) renderSearchInto(E.searchResults,m); else addSearchCard(m); }   // busca falada (LLM + áudio)
        else if(m.t==='sendNewResult'){ const sid=m.sessionId, rn=m.runnerId||'local'; if(sid) toast('▶ Nova sessão em execução'+(m.title?': '+String(m.title).slice(0,40):''),{onClick:()=>openSession(sid,rn),ariaLabel:'Abrir a nova sessão',duration:14000}); }
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
        else if(m.t==='topic_shift'){ toast('💭 Isso parece outro assunto — se quiser, abra uma sessão nova pra ele (menu ➕).'); }
        else if(m.t==='ack_speak'){ if(m.audio) playAudioOnce(m.audio); }   // Gap 18: confirmação curta ANTES do trabalho lento (busca/resumo/digest) — não mexe no status/turno
        else if(m.t==='queued'){ const runner=frameRunner(m); endVoiceOp(); justSent.delete(sessionStateKey(m.sessionId,runner)); const msg=m.message||(m.update?'Atualização em andamento — mensagem ficou na fila.':'Mensagem na fila — aguardando o turno atual terminar'); refreshComposer(); if(currentFrame(m)){ clearPending(); status('busy',msg); } toast(m.update?'🔄 '+msg:t('tQueued')); }
        else if(m.t==='voice_timing'){ try{ console.log('[voz] STT '+m.stt+'ms · locutor '+m.speaker+'ms · correção+gate '+m.preflight+'ms'); }catch(e){} }
        else if(m.t==='runs'){ const runner=m.runnerId||selectedRunner(), prev=activeRunsByRunner[runner]||[], now=m.active||[], sent=[...justSent].filter(key=>key.startsWith(runner+'\0')).map(key=>key.slice(runner.length+1)), finished=[...new Set([...prev,...sent])].filter(id=>!now.includes(id)); prev.forEach(id=>{ if(!now.includes(id)&&!(id===currentSession&&runner===currentSessionRunner)) unread.add(sessionStateKey(id,runner)); }); activeRunsByRunner[runner]=now; if(runner===sessionRunner())activeRuns=now; now.forEach(id=>justSent.delete(sessionStateKey(id,runner))); finished.forEach(id=>onTurnEnd(id,runner)); renderRecents(); refreshComposer(); scheduleAllRefresh(); }
        else if(m.t==='qr'){ E.qrImg.src=m.dataUri; E.qrUrl.textContent=m.url; }
        else if(m.t==='pushkey'){ if(pushKeyResolve){ const r=pushKeyResolve; pushKeyResolve=null; r(m.key); } }
        else if(m.t==='push_status'){ renderPushStatus(m.status); }
        else if(m.t==='push_test'){ renderPushStatus(m.status); if(E.pushTest){ E.pushTest.disabled=false; E.pushTest.textContent='Enviar teste'; } toast(m.ok?'Notificação de teste disparada. Feche o app e confirme se chegou no Android.':(m.message||'Push não está entregável.')); }
        else if(m.t==='wake_state'){ cfg.wake=m.enabled; saveCfg(); if(E.setWake) E.setWake.checked=m.enabled; }
        else if(m.t==='wake_event'){
          if(m.phase==='capturing') status('listening',t('spThinking'));
          else if(m.phase==='detected') status('listening',t('wakeDetected'));
          else if(m.phase==='mic_error') status('');
          else status('listening','Jarvis');
        }
        else if(m.t==='voice_state'){ speakers=m.speakers||[]; cfg.voiceGate=!!m.gate; saveCfg(); if(E.setGate)E.setGate.checked=cfg.voiceGate; renderSpk(); }
        else if(m.t==='voices'){ voiceList=m.voices||[]; voiceCur=m.current||''; renderVoiceCatalog(); }   // catálogo de vozes (Gap 6)
        else if(m.t==='voice_preview'){ if(m.audio) playAudioOnce(m.audio); }                                // ouvir amostra da voz
        else if(m.t==='enrolled'){ note('✓ Voz cadastrada: '+m.name+' ('+m.samples+' amostras).'); }
        else if(m.t==='error'){ creatingSession=false; pendingNewSession=null; endVoiceOp(); clearPending(); onTurnEnd(currentSession); clearLimitBanner(); addErr(m.message||'Falha na execução',{limit:!!m.limit}); } };
    }
    function playTTS(b64,closing){ status('speaking',t('spSpeaking'));
      audioMgr.play(b64,{ onEnd:()=>{ if(audioMgr.active) return;   // ainda há áudio na fila → adia re-armar o mic (evita voltar a ouvir no meio)
        status('');
        if(closing){ lastWasVoice=false; return; }                               // Gap 17: fechamento (ex. "obrigado") → não volta a escutar sozinho
        if(stagingActive && !recording){ startRec(true); return; }               // refino por voz em andamento → continua ouvindo
        if(askPendingVoice){ askPendingVoice=false; startAskVoice(); return; }   // decisão pendente → wizard de voz
        if(askActive) return;                                                    // card de decisão aberto → não escuta em contínuo
        if((cfg.continue || lastWasVoice) && !recording) startRec(true); } }); }
    // reprodução única (resumo falado): NÃO re-arma o mic
    function playAudioOnce(b64){ status('speaking',t('spSpeaking')); audioMgr.play(b64,{ onEnd:()=>{ if(!audioMgr.active) status(''); } }); }
    // ---------- voz ambiente: painel de refino (staging) ----------
    let stageEl=null;
    function showStage(m){ stagingActive=true;
      if(!stageEl){ stageEl=document.createElement('div'); stageEl.id='stagePanel';
        stageEl.style.cssText='position:fixed;left:50%;transform:translateX(-50%);bottom:calc(var(--composer-height,88px) + 10px);z-index:55;width:min(560px,94vw);background:var(--panel);border:1px solid #a78bfa66;border-radius:14px;padding:12px 14px;box-shadow:0 10px 34px #000b';
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
    function toast(message,options={}){const d=document.createElement('div');d.className='toast';d.textContent=message;d.setAttribute('role',options.onClick?'button':'status');if(options.onClick){d.tabIndex=0;d.setAttribute('aria-label',options.ariaLabel||message);d.onclick=()=>{d.remove();options.onClick();};d.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();d.click();}};}else d.onclick=()=>d.remove();document.body.appendChild(d);setTimeout(()=>{if(d.parentNode)d.remove();},Number(options.duration)||9000);return d;}
    // Relatório da sincronização de modelos: painel dismissível listando cada config que mudou (de → para).
    function syncReport(changes){ const ov=document.createElement('div'); ov.className='card'; ov.style.cssText='position:fixed;right:16px;bottom:calc(16px + var(--safe-bottom));max-width:390px;z-index:9999;background:var(--panel,#1b1d22);border:1px solid var(--line,#333);border-radius:10px;padding:12px 14px;box-shadow:0 8px 30px rgba(0,0,0,.45);font-size:13px';
      const h=document.createElement('div'); h.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:600'; h.innerHTML='<span>Modelos realocados</span>';
      const x=document.createElement('button'); x.className='ghost'; x.textContent='✕'; x.style.cssText='border:0;background:none;cursor:pointer;font-size:14px;padding:0 4px'; x.onclick=()=>ov.remove(); h.appendChild(x); ov.appendChild(h);
      changes.forEach(c=>{ const row=document.createElement('div'); row.style.cssText='margin:6px 0;line-height:1.35'; row.innerHTML='<div style="opacity:.85">'+esc(c.scope)+' <span class="mut">('+esc(c.agent)+')</span></div><div><span class="mut">'+esc(c.from)+'</span> → <b>'+esc(c.to)+'</b></div>'; ov.appendChild(row); });
      document.body.appendChild(ov); setTimeout(()=>{ if(ov.parentNode) ov.remove(); },20000); }

    // ---------- mic (manual + continuação hands-free com VAD) ----------
    let rec=null,chunks=[],recording=false,contTimer=null,lastWasVoice=false,discardRec=false;
    async function pauseWakeForRecording(){
      const N=window.__jarvisNative;
      if(!cfg.wake||!N||!N.wakeStop)return false;
      try{ await N.wakeStop(); await new Promise(r=>setTimeout(r,180)); return true; }catch(e){ return false; }
    }
    function resumeWakeAfterRecording(paused){
      const N=window.__jarvisNative;
      if(!paused||!cfg.wake||!N||!N.wakeStart)return;
      setTimeout(()=>{ try{ N.wakeStart(); }catch(e){} },450);
    }
    function micErrorText(e){
      const name=String((e&&e.name)||''), msg=String((e&&e.message)||e||'');
      if(!window.isSecureContext&&location.protocol==='http:') return 'O app está carregando o Hub por HTTP. A permissão Android pode estar concedida, mas o WebView pode bloquear áudio via web nesse contexto. Use HTTPS no JARVIS_APP_HUB_URL ou captura nativa.';
      if(/NotReadableError|TrackStartError|AbortError/i.test(name+msg)) return 'Microfone indisponível. Feche outra captura/listener e tente novamente.';
      if(/NotAllowedError|Permission/i.test(name+msg)) return 'Microfone bloqueado pelo WebView/navegador apesar da permissão do app. Isso geralmente é contexto inseguro, política do WebView ou permissão negada no site.';
      if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia) return 'Microfone não suportado neste contexto.';
      return msg||'não consegui abrir o microfone';
    }
    async function startRec(auto){ if(recording) return;
      let wakePaused=false;
      try{ wakePaused=await pauseWakeForRecording(); const st=await navigator.mediaDevices.getUserMedia({audio:{noiseSuppression:cfg.noise,echoCancellation:true,autoGainControl:true}}); rec=new MediaRecorder(st); chunks=[]; recording=true;
        // VAD: detecta fala e fim de fala (silêncio após falar) para não gravar o tempo todo
        const ac=new AudioContext(); const src=ac.createMediaStreamSource(st); const an=ac.createAnalyser(); an.fftSize=512; src.connect(an);
        const buf=new Uint8Array(an.fftSize); let spoke=false,silence=0,elapsed=0; const TH=cfg.noise?10:6;
        const baseSIL=Math.min(6000,Math.max(600,Math.round((cfg.silenceSec||1.8)*1000)));   // Gap 2: pausa tolerada após falar (não corta pausa de raciocínio); configurável nos ajustes
        // Gap 12 (parcial, sem precisar de transcrição incremental): silêncio ADAPTATIVO por gravação.
        // Quem já pausou quase até o limite E retomou a fala (sinal de que está pensando em voz alta,
        // não que terminou) ganha mais paciência nas pausas SEGUINTES desta mesma gravação — até um
        // teto — em vez de um threshold fixo que trata toda pausa de raciocínio igual.
        let adaptiveSIL=baseSIL, nearMiss=false;
        const poll=setInterval(()=>{ an.getByteTimeDomainData(buf); let mx=0; for(const v of buf) mx=Math.max(mx,Math.abs(v-128)); elapsed+=100;
          if(mx>TH){ if(spoke&&nearMiss) adaptiveSIL=Math.min(baseSIL+2000,adaptiveSIL+400); spoke=true; silence=0; nearMiss=false; }
          else if(spoke){ silence+=100; if(silence>=adaptiveSIL*0.6) nearMiss=true; }
          if(auto && rec.state==='recording'){ if(spoke&&silence>=adaptiveSIL){ rec.stop(); }   // parou de falar (pausa >= limiar adaptativo) -> encerra
                    else if(!spoke&&elapsed>=6000){ rec.stop(); } }                        // ninguém falou em 6s -> desiste
        },100);
        rec.ondataavailable=(e)=>chunks.push(e.data);
        rec.onstop=async()=>{ clearInterval(poll); clearTimeout(contTimer); ac.close(); st.getTracks().forEach(t=>t.stop()); resumeWakeAfterRecording(wakePaused); recording=false; E.mic.classList.remove('on'); E.mic.innerHTML=MIC_ICON; syncComposerActions(); if(E.micCancel)E.micCancel.classList.add('hidden'); status('');
          if(discardRec){ discardRec=false; return; }   // descartado pelo usuário -> nao envia
          if(auto && !spoke){ toast('🎤 Parei de ouvir (silêncio).'); return; } // Gap 5: avisa que encerrou de propósito — não fica ambíguo com travamento
          const b64=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result.split(',')[1]);fr.readAsDataURL(new Blob(chunks,{type:'audio/webm'}));});
          // barge-in: falar POR CIMA do agente (ou já em refino) → vai para o staging (refino), não pro chat
          if(ttsPlaying || stagingActive){ stopTTS(); stagingActive=true; showStage({say:'refinando…'}); status('speaking',t('spRefining')); tx({t:'stage_voice',audio:b64,ext:'webm',sessionId:currentSession}); return; }
          // Sessão ocupada NÃO bloqueia mais a voz. O Hub transcreve e ENFILEIRA o texto resultante
          // (queueLocalTurn → responde {t:'queued', voice:true} e faz broadcastQueue), igual ao texto.
          // O usuário grava, vê "transcrevendo…" e a mensagem entra na fila para rodar no próximo turno.
          const sessionBusy=busy(currentSession);
          status('busy', sessionBusy ? '🎧 transcrevendo para a fila…' : '🎧 transcrevendo…');   // Gap 5: feedback claro durante o STT
          lastWasVoice=true; stick=true; bumpSession(currentSession); markJustSent(currentSession); tx({t:'voice',audio:b64,ext:'webm',speak,model:curModel,effort:curEffort,permissionMode:curMode||undefined,auto:routeAutoFor(currentSession),sessionId:currentSession}); showPending(); refreshComposer(); };
        discardRec=false; rec.start(); E.mic.classList.add('on'); E.mic.textContent='⏺'; syncComposerActions(); if(E.micCancel && !auto)E.micCancel.classList.remove('hidden'); status('listening', auto?t('spListeningAns'):t('spListening')); if(auto)tx({t:'wake_event',phase:'capturing',sessionId:currentSession});
        if(auto) contTimer=setTimeout(()=>{ if(rec.state==='recording') rec.stop(); }, Math.max(6,cfg.continueSec)*1000); // teto de segurança
      }catch(e){ resumeWakeAfterRecording(wakePaused); const msg=t('wakeMicError')+': '+micErrorText(e); addErr(msg); toast(msg); tx({t:'wake_event',phase:'mic_error',sessionId:currentSession,error:String((e&&e.message)||e)}); recording=false; status(''); } }
    E.mic.onclick=()=>{ if(recording){ rec.stop(); } else startRec(false); };
    // Descartar: para a gravacao e NAO envia (comecei a falar besteira / sessao errada).
    E.micCancel.onclick=()=>{ if(!recording||!rec)return; discardRec=true; try{rec.stop();}catch(e){} status(''); };

    // ---------- composer / misc ----------
    E.speak.onclick=()=>{ speak=!speak; cfg.voice=speak; saveCfg(); setSpeakBtn(); if(!speak) stopTTS(); };   // mutar (🔇) também PARA o áudio que já está tocando
    function setSide(o){ E.side.classList.toggle('open',o); E.backdrop.classList.toggle('hidden',!o); }
    const closeSide=()=>setSide(false);
    E.menuBtn.onclick=()=>setSide(!E.side.classList.contains('open'));
    E.backdrop.onclick=closeSide; E.sideClose.onclick=closeSide;
    function parseFileHref(raw){
      let h=String(raw||'').trim(), line=0;
      try{ h=decodeURIComponent(h); }catch(e){}
      h=h.replace(/^<|>$/g,'').replace(/^file:\/+/i,'').replace(/\\/g,'/');
      h=h.replace(/^\/([A-Za-z]:\/)/,'$1');
      const m=h.match(/^(.*):(\d+)(?::\d+)?$/);
      if(m&&m[1]){ h=m[1]; line=Number(m[2])||0; }
      return {path:h,line};
    }
    E.log.addEventListener('click',(e)=>{
      if(e.target.classList.contains('copy')){ navigator.clipboard.writeText(e.target.nextElementSibling.textContent); e.target.textContent='copiado'; setTimeout(()=>e.target.textContent='copiar',1200); return; }
      const tableCopy=e.target.closest&&e.target.closest('.mdtable-copy'); if(tableCopy){ const table=tableCopy.closest('.mdtable-wrap')?.querySelector('table'); if(table){ navigator.clipboard.writeText(tableText(table)); const old=tableCopy.textContent; tableCopy.textContent='copiado'; setTimeout(()=>tableCopy.textContent=old,1200); } return; }
      const tablePng=e.target.closest&&e.target.closest('.mdtable-png'); if(tablePng){ exportTablePng(tablePng.closest('.mdtable-wrap')?.querySelector('table'), tablePng); return; }
      const dbgWork=e.target.closest('.dbg-work'); if(dbgWork){ e.stopPropagation(); const root=dbgWork.dataset.root; if(root){ openWorkPanel(); openWorkNode(root); } return; }
      const refopen=e.target.closest('.refopen'); if(refopen){ e.stopPropagation(); if(refopen.dataset.runner){ routedMachine=refopen.dataset.runner; tx({t:'runner',runnerId:routedMachine}); } openSession(refopen.dataset.id,refopen.dataset.runner); return; }
      const exec=e.target.closest('.exec'); if(exec){ e.stopPropagation(); launchSuggestionInNewSession(exec.dataset.action,{id:exec.dataset.id,runnerId:exec.dataset.runner}); return; }
      const match=e.target.closest('.match'); if(match){ if(match.dataset.action){ e.stopPropagation(); launchSuggestionInNewSession(match.dataset.action,{id:match.dataset.id,runnerId:match.dataset.runner}); return; } if(match.dataset.runner){ routedMachine=match.dataset.runner; tx({t:'runner',runnerId:routedMachine}); } openSession(match.dataset.id,match.dataset.runner); return; }
      // file references in the chat (markdown links) must NOT navigate away — open in the panel.
      const a=e.target.closest && e.target.closest('a'); if(a){ const href=a.getAttribute('href')||'';
        if(/^(https?:|mailto:|tel:|#)/i.test(href)) return; // real links pass through
        e.preventDefault(); const parsed=parseFileHref(href), norm=s=>s.replace(/\\/g,'/'); const h=norm(parsed.path).replace(/^\.\//,''); const base=h.split('/').pop();
        const f=curFiles.find(x=>norm(x.path).endsWith(h)) || curFiles.find(x=>norm(x.path).split('/').pop()===base);
        if(f) openFile(f.path,f.action,{line:parsed.line}); else openFile(parsed.path,'read',{line:parsed.line}); }
    });
    E.attach.onclick=()=>E.file.click();
    const readB64 = f => new Promise(r=>{ const fr=new FileReader(); fr.onload=()=>r(fr.result); fr.readAsDataURL(f); });
    function isTextUpload(f){ const name=String(f.name||'').toLowerCase(), type=String(f.type||'').toLowerCase();
      if(type.startsWith('text/'))return true;
      if(/(json|xml|yaml|yml|csv|javascript|typescript|markdown|x-sh|x-python|sql)/.test(type))return true;
      return /\.(txt|md|markdown|json|jsonl|csv|ts|tsx|js|jsx|mjs|cjs|css|scss|html|htm|xml|yml|yaml|toml|ini|env|log|sql|py|ps1|sh|bat|cmd|java|kt|swift|go|rs|php|rb|c|cc|cpp|h|hpp|cs)$/i.test(name);
    }
    async function addFile(f){ if(f.type&&f.type.startsWith('image/')){ const url=await readB64(f); attachments.push({name:f.name||`colada-${Date.now()}.png`, content:String(url).split(',')[1], image:true, preview:url}); }
      else if(isTextUpload(f)){ attachments.push({name:f.name,content:await f.text(),mime:f.type||'text/plain',size:f.size||0}); }
      else { const url=await readB64(f); attachments.push({name:f.name,content:String(url).split(',')[1]||'',binary:true,mime:f.type||'application/octet-stream',size:f.size||0}); } }
    E.file.onchange=async()=>{ for(const f of E.file.files) await addFile(f); E.file.value=''; renderAttach(); };
    // Ctrl+V de imagem direto no chat (igual ao Claude)
    E.input.addEventListener('paste', async (e)=>{ const its=(e.clipboardData&&e.clipboardData.items)||[]; let got=false;
      for(const it of its){ if(it.kind==='file'&&it.type.startsWith('image/')){ const b=it.getAsFile(); if(b){ got=true; await addFile(b); } } }
      if(got){ e.preventDefault(); renderAttach(); } });
    function renderAttach(){ E.attachRow.innerHTML=''; attachments.forEach((a,i)=>{ const c=document.createElement('span'); c.className='chip'+(a.image?' imgchip':'');
      const rm=()=>{ attachments.splice(i,1); renderAttach(); };
      if(a.image&&a.preview){ c.innerHTML=`<img src="${a.preview}" alt="">`; const im=c.querySelector('img'); if(im) im.onclick=(e)=>{ e.stopPropagation(); openImg(a.preview); }; const x=document.createElement('span'); x.className='rmx'; x.textContent='✕'; x.title='Remover'; x.onclick=(e)=>{ e.stopPropagation(); rm(); }; c.appendChild(x); }
      else { c.textContent='📎 '+a.name+' ✕'; c.onclick=rm; }
      E.attachRow.appendChild(c); }); syncComposerActions(); }
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
    // Por que a fila não saiu, por sessão (frame `queue`.blocked). Sem isto a barra só sabia dizer
    // "rodam automaticamente agora" — mentira sempre que o despacho estava travado por algum motivo.
    const queueBlockBySession={};
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
    // A bolha otimista foi criada para um TURNO que não vai acontecer (o servidor desviou o texto para
    // um debate). Some por msgId — casar por texto falharia, já que o servidor republica o recado com
    // prefixo, e a bolha crua ficaria duplicada na conversa.
    function dropOptimisticUser(sid,runner,msgId){ const list=optimisticList(sid,runner); const i=list.findIndex(x=>x.msgId===msgId); if(i<0)return; const [hit]=list.splice(i,1); try{ hit.el.remove(); }catch(e){} }
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
      const running=busy(currentSession), block=false;
      if(E.stopBtn) E.stopBtn.classList.toggle('hidden',!curBusy);
      E.input.disabled=block; E.sendBtn.disabled=block; if(E.mic)E.mic.disabled=block;
      renderSolutionPill();   // sessão trocou/virou nativa → a pill e a barra do Espaço de Soluções acompanham
      E.input.placeholder=running?'Turno em andamento — enviar adiciona à fila automática'
        :(debateLive(currentSession)?'🗣️ Debate em andamento — o que você escrever entra na próxima rodada':t('composerPh'));
      syncComposerActions(); renderQueue(); updateStopStatus(); maybeReload(); }
    // id de mensagem p/ idempotência: o runner executa um turnId no máximo uma vez (re-entrega do
    // MESMO frame reusa o id e é ignorada). Cada submit gera um id novo (dois envios = dois turnos).
    const uid=()=>{ try{ return crypto.randomUUID(); }catch(e){ return 'm'+Date.now()+Math.random().toString(36).slice(2,8); } };
    function sendMsgTo(sid,text,atts){ if(!sid)return; const msgId=uid(), body=text||'(anexo)'; lastWasVoice=false;
      if(askActive&&sid===currentSession){ const runner=askActive.runnerId||sessionRunner(); try{askActive.card.remove();}catch(e){} askActive=null; askVoice=false; clearAsk(sid,runner); tx({t:'ask_clear',sessionId:sid}); }
      const askKey=askStateKey(sid); if(askingSids.delete(askKey)) tx({t:'ask_clear',sessionId:sid}); bumpSession(sid); markJustSent(sid);
      if(sid===currentSession){ stick=true; addOptimisticUser(sid,msgId,body,atts||[]); if(!curStarted){ curStarted=true; renderControls(); } showPending(); }
      tx({t:'send',text:body,speak,model:curModel,effort:curEffort,permissionMode:curMode||undefined,auto:routeAutoFor(sid),sessionId:sid,attachments:atts||[],msgId});
      refreshComposer(); }
    function sendMsg(text,atts){ sendMsgTo(currentSession,text,atts); }   // compat
    // Sugestão "executar ação": roda em uma sessão NOVA com a config de IA/modelo/esforço do chat atual,
    // SEM sair da sessão de origem. O servidor cria a sessão e responde `sendNewResult` com o id — a
    // sessão aparece no histórico/execuções e o toast oferece um atalho pra abri-la quando quiser.
    function suggestionTitleFrom(action,ref){ const s=String(action||'').replace(/\s+/g,' ').trim(); return String((ref&&ref.title)||s||'Nova sessão').slice(0,60); }
    function launchSuggestionInNewSession(action,ref){ if(!action){ toast('Sem ação para executar'); return; }
      tx({t:'sendNew',text:action,agent:currentAgent,cwd:curCwd,model:curModel,effort:curEffort,permissionMode:curMode||undefined,auto:routeAutoFor(currentSession||''),msgId:uid(),title:suggestionTitleFrom(action,ref),ref:(ref&&ref.id)?{sessionId:ref.id,runnerId:ref.runnerId||'local'}:undefined});
      toast('▶ Executando em nova sessão…'); }
    // Fim de turno de uma sessão. O FLUSH da fila agora é do SERVIDOR (flushQueue no hub): ele
    // envia a fila acumulada e re-transmite {t:queue}/{t:message}. Aqui só destravamos o composer.
    function onTurnEnd(sid,runner){ if(!sid)return; const rid=runner||sessionRunner(), key=sessionStateKey(sid,rid); justSent.delete(key); delete stopping[key];
      const runs=activeRunsByRunner[rid]||[]; if(runs.includes(sid)){ activeRunsByRunner[rid]=runs.filter(id=>id!==sid); if(rid===sessionRunner())activeRuns=activeRunsByRunner[rid]; }
      if(sid===currentSession&&rid===currentSessionRunner) updateStopStatus(); refreshComposer(); }
    function clearQueue(){ if(currentSession){ queueBySession[sessionStateKey(currentSession,currentSessionRunner)]=[]; tx({t:'clearqueue',sessionId:currentSession}); } refreshComposer(); }
    // ── Acompanhamento de fluxo (F2/F3/F5/F6): onde estou, marcar, avançar e pular com confirmação.
    // Regra combinada: NÃO se avança enquanto há turno em execução; pular fases pede confirmação aqui
    // na UI (pelo chat, a IA faz bypass e a gente só acompanha).
    let wfRun=null, wfOpen=false, wfDefs=[], wfRunsAll=[], wfHideSuggest=false;
    // Seletor 🧭: qual fluxo teve os passos abertos para entrada direta (`null` = padrão, que abre
    // sozinho quando só existe um fluxo) e se a gaveta opcional de Tarefa está aberta.
    let wfPickOpen=null, wfTaskOpen=false;
    // Fluxo por tarefa (F1/F3): vínculo do projeto, arquivos locais de feature, cache de meta e a
    // tarefa ARMADA (vale para o próximo fluxo iniciado nesta sessão; persiste por sessão).
    let wfTaskBinding=null, wfLocalFiles=null, wfLocalDir='docs/features', wfLocalShow=false;
    // Cofre de conexões (C1/C2): lista vinda do Hub (sem NENHUM segredo — só envOk booleano),
    // catálogo de provedores, resultados de busca e o modo "gerenciar" do popup.
    let wfConnections=null, wfProviders=[], wfSearchResults=null, wfConnManage=false;
    const wfTaskMeta={};
    function wfMetaKey(t){ return (t.tracker||'')+' '+t.key; }
    function wfTaskArmKey(){ return (currentSessionRunner||'local')+' '+(currentSession||''); }
    function wfTaskArmGet(){ try{ const all=JSON.parse(localStorage.getItem('jarvis_task_arm')||'{}'); return all[wfTaskArmKey()]||null; }catch(e){ return null; } }
    function wfTaskArmSet(v){ try{ const all=JSON.parse(localStorage.getItem('jarvis_task_arm')||'{}'); if(v)all[wfTaskArmKey()]=v; else delete all[wfTaskArmKey()]; localStorage.setItem('jarvis_task_arm',JSON.stringify(all)); }catch(e){} }
    function wfSessionRuns(){ return (wfRunsAll||[]).filter(r=>r.status==='active'&&(r.sessions||[]).includes(currentSession)); }
    const WF_ICON={pending:'○',done:'✓',skipped:'⤼'};
    // Rótulo curto para a trilha ("0 — Escopo" → ESCOPO, "GATE — revisão" → GATE). O título inteiro fica
    // no tooltip: abreviar é para caber, não para esconder.
    function wfShort(title){
      const t=String(title||'').replace(/^\s*(?:fase|phase|step|etapa)?\s*\d{1,2}\s*[—–\-.:)]\s*/i,'').trim()||String(title||'');
      const w=t.split(/[\s—–\-:/_]+/).filter(Boolean)[0]||t;
      return w.length>7?w.slice(0,7):w;
    }
    // Um passo ainda "devendo" evidência — marca o pontinho âmbar na trilha. Só sinaliza.
    function wfStepPending(st){ return !!(st&&st.requiresEvidence&&!((st.evidence||[]).length)); }
    function renderWfRun(){
      renderWfStep();                 // o chip do composer segue o mesmo estado da faixa
      if(!E.wfRun) return;
      // SEM fluxo ativo a faixa não existe. Ela ocupava uma linha inteira acima do composer para dizer
      // que não havia nada acontecendo, e o botão que oferecia levava a um diálogo pedindo o NÚMERO do
      // fluxo. Iniciar agora é o chip 🧭 do composer, que já lista os fluxos e os passos com nome.
      if(!wfRun){ E.wfRun.classList.add('hidden'); E.wfRun.innerHTML=''; return; }
      const s=wfRun.summary||{}, steps=wfRun.steps||[];
      // Encolhido COM fluxo ativo: a alça mostra o passo em foco, não um "fluxo" genérico. Esconder a
      // faixa não pode virar esconder que existe um fluxo entrando em todo turno da IA — some o painel,
      // fica o rótulo. Quem quer encerrar de verdade usa "Parar de acompanhar".
      if(wfHideSuggest){
        const curStep=steps.find(x=>x.id===wfRun.currentStepId);
        E.wfRun.classList.remove('hidden'); E.wfRun.classList.remove('open');
        E.wfRun.innerHTML='<div class="wfhdr"><button class="wfact wf-restore" type="button" title="Reabrir a faixa do fluxo">🧭 '+esc(curStep?curStep.title:(wfRun.workflowName||'fluxo'))+'</button></div>';
        return;
      }
      // Meta da tarefa (título/link/descrição/resumo) vem do cache do Hub; pede uma única vez.
      if(wfRun.task&&wfRun.task.key&&authUser&&authUser.role==='owner'){ const mk=wfMetaKey(wfRun.task); if(wfTaskMeta[mk]===undefined){ wfTaskMeta[mk]=null; tx({t:'task_meta_get',tracker:wfRun.task.tracker||'',key:wfRun.task.key}); } }
      const wfOthers=wfSessionRuns().filter(r=>r.runId!==wfRun.runId);
      E.wfRun.classList.remove('hidden'); E.wfRun.classList.toggle('open',wfOpen);
      const cur=steps.find(x=>x.id===wfRun.currentStepId), curIdx=steps.findIndex(x=>x.id===wfRun.currentStepId);
      const falta=(s.missingEvidence||[]).length;
      // De onde este fluxo veio (qual skill) — a dúvida "qual é esse fluxo mesmo?" tem que morrer aqui.
      const wfSrc=(wfDefs||[]).find(d=>d.id===wfRun.workflowId), wfPath=wfSrc&&wfSrc.source&&wfSrc.source.path;
      // A origem é uma PISTA, não um caminho: a regra antiga só encurtava `skills/<nome>/…` e despejava
      // o caminho inteiro para qualquer outra pasta (`reference/flow/00-header.md` ocupava meia faixa).
      // Pasta-mãe do arquivo serve aos dois casos — o caminho completo continua no title.
      const wfSeg=wfPath?wfPath.split('/').filter(Boolean).slice(-2,-1)[0]||wfPath:'';
      const wfFrom=wfPath?(' <span class="mut" title="'+esc(wfPath)+'">· 📄 '+esc(wfSeg)+'</span>'):'';
      E.wfRun.innerHTML='<div class="wfhdr"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">🧭 <b>'+esc(wfRun.workflowName||wfRun.workflowId)+'</b>'+wfFrom
        // Sem tarefa vinculada, `taskLabel` devolve o literal "(sem tarefa)" — que é verdadeiro e por
        // isso era impresso na faixa. Dizer "não tem" ocupa espaço para não informar nada.
        +((wfRun.task&&wfRun.task.key)?' <span class="mut">· '+esc(wfRun.taskLabel||wfRun.task.key)+'</span>':'')
        +' <span class="wfbadge">'+(curIdx>=0?('fase '+(curIdx+1)+' de '+steps.length):((s.done||0)+'/'+(s.total||0)))+'</span>'
        +(wfOthers.length?' <span class="mut" title="Outras tarefas acompanhadas nesta sessão — troque o foco pelo chip 🧭">· +'+wfOthers.length+' tarefa'+(wfOthers.length===1?'':'s')+'</span>':'')
        +(cur?' <span class="mut">→ '+esc(cur.title)+'</span>':' <span style="color:#4ade80">concluído</span>')
        +(falta?' <span style="color:#f5b544" title="passos concluídos que pediam evidência">⚠ '+falta+' sem evidência</span>':'')
        +'</span><span class="row" style="gap:4px;flex:none">'
        +(cur?'<button class="wfact wf-adv" type="button" title="Concluir o passo atual e ir para o próximo">Avançar</button>':'')
        +'<button class="wfact wf-tog" type="button">'+(wfOpen?'ocultar':'passos')+'</button>'
        // Dois gestos DIFERENTES, dois botões: encolher (⌄) só esconde a faixa e o fluxo continua no
        // turno; parar (✕) encerra. Um ✕ que apenas encolhe é a armadilha — quem clica nele quer sair,
        // e no celular não existe tooltip para explicar que não saiu.
        +'<button class="wfact wf-dismiss" type="button" title="Encolher a faixa — o fluxo CONTINUA acompanhando e entrando no turno da IA">⌄</button>'
        +'<button class="wfact wf-stop" type="button" title="Parar de acompanhar este fluxo (pede confirmação)">✕</button></span></div>'
        // Trilha: clicar num ponto FOCA aquela fase (sem marcar nada como pulado) — mesma semântica do
        // seletor do composer. Pular de propósito continua sendo o clique na lista detalhada, que avisa.
        +'<div class="wftrack">'+steps.map((st,i)=>'<button type="button" class="wfph '+st.state+(st.id===wfRun.currentStepId?' cur':'')+(wfStepPending(st)?' evid':'')+'" data-id="'+esc(st.id)+'"'
          +' title="'+esc((i+1)+'. '+st.title+(st.kind==='gate'?' (gate)':'')+(st.requiresEvidence?' · pede evidência':'')+' — clique para focar')+'">'
          +'<span class="rail"></span><span class="d"></span><span class="l">'+esc(wfShort(st.title))+'</span></button>').join('')+'</div>'
        +'<div class="wfsteps">'
        // A TAREFA do fluxo, com link e Resumir — o dev vê o que é sem sair do Jarvis (F1/F2).
        +(function(){ if(!(wfRun.task&&wfRun.task.key)) return '';
          const tm=wfTaskMeta[wfMetaKey(wfRun.task)]||null;
          const title=(tm&&tm.title)||wfRun.taskLabel||wfRun.task.key;
          const head=tm&&tm.url?('<a href="'+esc(tm.url)+'" target="_blank" rel="noopener">'+esc(title)+' ↗</a>'):esc(title);
          const body=tm&&tm.summary?('<div class="mut" style="white-space:pre-wrap;margin-top:4px;font-size:12px">'+esc(tm.summary)+'</div>')
            :(tm&&tm.description?('<div class="mut" style="margin-top:4px;font-size:12px">'+esc(tm.description.slice(0,280))+(tm.description.length>280?'…':'')+'</div>'):'');
          const canSum=!!(tm&&(tm.description||tm.title));
          return '<div class="wftaskinfo" style="padding:4px 4px 8px;margin-bottom:4px;border-bottom:1px solid rgba(127,127,127,.25);font-size:12.5px">🎯 '+head
            +(canSum?' <button class="wfact wf-sum" type="button" title="Resumir a tarefa (objetivo, critérios, riscos)">'+(tm&&tm.summary?'Re-resumir':'Resumir')+'</button>':'')
            +body+'</div>'; })()
        // Outras tarefas da sessão: uma linha cada, com troca de foco em um clique (F3).
        +(wfOthers.length?wfOthers.map(r=>{ const os=r.summary||{}; return '<div class="wfs" style="opacity:.85"><span class="wfst">↔</span><span class="wft" title="'+esc(r.workflowName||'')+'">'+esc(r.taskLabel||r.workflowName)+' <span class="mut">'+(os.current?esc(os.current.title):'concluído')+' · '+(os.done||0)+'/'+(os.total||0)+'</span></span><button class="wfact wf-focus" data-run="'+esc(r.runId)+'" type="button" title="Tornar esta a tarefa em foco da sessão">focar</button></div>'; }).join(''):'')
        +steps.map((st,i)=>'<div class="wfs '+st.state+(st.id===wfRun.currentStepId?' cur':'')+'" data-id="'+esc(st.id)+'">'
          +'<span class="wfst">'+(WF_ICON[st.state]||'○')+'</span>'
          +'<span class="wft" title="'+esc(st.title)+'">'+(i+1)+'. '+esc(st.title)+'</span>'
          +(st.kind==='gate'?'<span class="wfbadge">gate</span>':'')
          +(st.requiresEvidence?('<span class="wfbadge" style="'+((st.evidence||[]).length?'color:#4ade80':'color:#f5b544')+'" title="'+((st.evidence||[]).length?'evidência anexada':'pede evidência')+'">evid'+((st.evidence||[]).length?' ✓':'')+'</span>'):'')
          +'<button class="wfact wf-ev" data-id="'+esc(st.id)+'" type="button" title="Anexar evidência">📎</button>'
          +'<button class="wfact wf-mark" data-id="'+esc(st.id)+'" type="button" title="'+(st.state==='done'?'Desmarcar':'Marcar como feito')+'">'+(st.state==='done'?'↺':'✓')+'</button>'
          +'</div>').join('')
        // A porta de saída. Fora da classe `.wfs` de propósito: aquela linha é clicável e significa
        // "pular para este passo" — um rodapé com o mesmo nome herdaria o clique errado.
        +'<div class="wffoot" style="display:flex;align-items:center;gap:6px;margin-top:5px;padding-top:6px;border-top:1px solid rgba(127,127,127,.25)">'
          +'<span class="mut" style="flex:1;min-width:0;font-size:11px">Encerrar este acompanhamento</span>'
          +'<button class="wfact wf-finish" type="button" title="O fluxo chegou ao fim: registra como concluído e sai do turno da IA">✓ Concluir</button>'
          +'<button class="wfact wf-stop" type="button" title="Não quero mais este fluxo aqui: sai da faixa e do turno da IA">✕ Parar</button>'
        +'</div></div>';
      // Fluxo longo (o Forge mostra 14 fases) nasce rolado no começo e esconde justamente onde você está.
      try{ const c=E.wfRun.querySelector('.wfph.cur'); if(c) c.scrollIntoView({block:'nearest',inline:'center'}); }catch(e){}
    }
    // ── Seletor de PASSO no composer (🧭). O jeito do dia a dia: você não "caminha um fluxo", você diz
    // "agora é TDD" e manda. Escolher um passo é o próprio ato de iniciar — não existe formulário antes.
    // Os passos anteriores continuam pendentes de propósito (entrar no meio não é ter pulado o começo).
    function wfCurStep(){ if(!wfRun||!wfRun.currentStepId) return null; return (wfRun.steps||[]).find(s=>s.id===wfRun.currentStepId)||null; }
    function wfStepHint(st){ if(!st) return ''; if(st.hint) return st.hint;
      const def=(wfDefs||[]).find(d=>d.id===(wfRun&&wfRun.workflowId));   // runs antigos não guardam hint
      const ds=def&&(def.steps||[]).find(s=>s.id===st.id); return (ds&&ds.hint)||''; }
    // Evidência pendente SINALIZA (chip âmbar) e nunca trava o envio: é a mesma regra dos gates, e uma
    // trava aqui seria contornada no terceiro dia de uso.
    function wfNeedsEvidence(st){ return !!(st&&st.requiresEvidence&&!((st.evidence||[]).length)&&!attachments.length); }
    function renderWfStep(){
      if(!E.wfStepBtn) return;
      const on=!!(currentSession&&(wfDefs||[]).length);
      E.wfStepBtn.classList.toggle('hidden',!on);
      if(!on) return;
      const st=wfCurStep();
      // Sem fluxo o chip é a ÚNICA porta de entrada (a faixa de sugestão morreu), então ele não pode
      // mostrar "—": diz o que faz. Com fluxo, mostra o passo em foco.
      if(E.wfStepName) E.wfStepName.textContent=st?st.title:(wfRun?'—':'Fluxo');
      E.wfStepBtn.classList.toggle('needs-ev',wfNeedsEvidence(st));
      E.wfStepBtn.title=st?('Passo em foco: '+st.title+(wfNeedsEvidence(st)?' — pede evidência (não bloqueia o envio)':'')+'\nClique para trocar de passo ou de fluxo.')
        :'Iniciar um fluxo de trabalho nesta sessão';
      // O alvo aparece no botão de enviar: evita mandar para a fase errada por distração, sem travar nada.
      if(E.sendBtn) E.sendBtn.title=st?('Enviar → '+st.title):'Enviar';
      // O hint do passo é o que ele espera de você — vale mais como placeholder do que "Fale ou digite…".
      const hint=wfStepHint(st);
      // Com debate vivo o placeholder pertence ao debate: ele diz para onde a mensagem VAI, e o hint do
      // passo diz só o que o passo espera. Errar o destino é pior do que perder a dica.
      if(hint && E.input && !busy(currentSession) && !debateLive(currentSession)) E.input.placeholder='🧭 '+st.title+' — '+hint;
    }
    function wfPickStep(defId,stepId){
      closePop();
      if(!currentSession){ toast(t('tOpenFirst')); return; }
      // Mesmo fluxo já acompanhado: só move o foco. Fluxo diferente (ou nenhum): nasce um run já no
      // passo — e leva a tarefa ARMADA (colada ou arquivo de feature), que é consumida no início.
      if(wfRun&&wfRun.workflowId===defId) tx({t:'workflow_run_update',runId:wfRun.runId,sessionId:currentSession,op:'focus',stepId});
      else { const arm=wfTaskArmGet()||{}; tx({t:'workflow_run_start',workflowId:defId,sessionId:currentSession,stepId,task:arm.task||{tracker:'',key:''},taskInput:arm.input||undefined,taskMeta:arm.meta||undefined}); wfTaskArmSet(null); }
    }
    function wfPopIsOpen(){ return !!document.querySelector('.pop .wftask-anchor'); }
    // ── Gerenciar conexões (C1): listar/verificar/apagar/adicionar — segredo NUNCA passa por aqui,
    // só o NOME da env var. A identidade verificada é o que diz DE QUEM é cada conexão.
    function buildWfConnManage(p){
      p.appendChild(ph('Conexões (cofre)'));
      const back=document.createElement('button'); back.type='button'; back.className='opt'; back.textContent='← voltar';
      // Volta para a gaveta de Tarefa ABERTA: foi de lá que se entrou no cofre, e reabrir fechado
      // devolveria o usuário para um menu que não parece o que ele estava usando.
      back.onclick=()=>{ wfConnManage=false; wfTaskOpen=true; closePop(); togglePop(E.wfStepBtn,buildWfStepPop); };
      p.appendChild(back);
      (wfConnections||[]).forEach(c=>{
        const row=document.createElement('div'); row.style.cssText='padding:4px 2px 6px;border-bottom:1px solid rgba(127,127,127,.2);font-size:12px;max-width:300px';
        const who=c.identity?('@'+(c.identity.login||c.identity.id)):'não verificada';
        const srcBadge=c.secretSource==='cofre'?' <span class="mut" title="o valor está no cofre local do Jarvis">🔒 cofre</span>'
          :c.secretSource==='ambiente'?' <span class="mut" title="o valor vem do ambiente externo do Hub (vence o cofre)">🌐 ambiente</span>'
          :' <span style="color:#f5b544" title="nenhum valor: cole o segredo em ⧉">⚠ sem segredo</span>';
        row.innerHTML='<b>'+esc(c.label)+'</b> <span class="mut">('+esc(c.provider)+' · '+esc(who)+')</span>'+srcBadge
          +(c.lastError?'<div class="mut" style="color:#f87171;font-size:11px">'+esc(String(c.lastError).slice(0,90))+'</div>':'')
          +'<div class="row" style="gap:4px;margin-top:3px"><button class="wfact wfc-secret" data-id="'+esc(c.id)+'" type="button" title="Colar/trocar o segredo desta conexão">⧉ Segredo</button><button class="wfact wfc-verify" data-id="'+esc(c.id)+'" type="button">Verificar</button><button class="wfact wfc-del" data-id="'+esc(c.id)+'" type="button">Apagar</button></div>';
        p.appendChild(row);
      });
      if(!(wfConnections||[]).length){ const d=document.createElement('div'); d.className='mut'; d.style.cssText='font-size:11.5px;padding:2px'; d.textContent='Nenhuma conexão no cofre.'; p.appendChild(d); }
      const add=document.createElement('button'); add.type='button'; add.className='opt'; add.textContent='+ adicionar conexão';
      add.onclick=async()=>{
        closePop();
        const provs=wfProviders||[];
        const pick=await dialog({title:'Provedor:\n\n'+provs.map((x,i)=>(i+1)+'. '+x.label+(x.tier===2?' (identidade só, por enquanto)':'')).join('\n'),input:true,placeholder:'número',okText:'Continuar'});
        if(pick==null) return; const spec=provs[parseInt(pick,10)-1]; if(!spec){ toast('Opção inválida'); return; }
        const label=await dialog({title:'Rótulo da conexão (ex.: "GitHub ACME", "Linear pessoal"):',input:true,okText:'Continuar'});
        if(label==null||!label.trim()) return;
        const config={};
        for(const f of (spec.fields||[])){ const v=await dialog({title:spec.label+' — '+f.label+(f.required?'':' (opcional)')+':',input:true,okText:'Continuar'}); if(v==null&&f.required) return; if(v&&v.trim()) config[f.key]=v.trim(); }
        // Segredo: COLA O VALOR aqui e o Jarvis guarda no cofre local (fora de git) e injeta no
        // ambiente na hora — sem caçar .env. Deixar vazio é o caminho avançado: apontar env var própria.
        const refs={}, pending=[];
        const mkName=(suffix)=>('JARVIS_SECRET_'+spec.id+'_'+label+(suffix?'_'+suffix:'')).toUpperCase().replace(/[^A-Z0-9_]+/g,'_').replace(/^_+|_+$/g,'').slice(0,80);
        for(let i=0;i<(spec.secrets||[]).length;i++){ const s=spec.secrets[i];
          const v=await dialog({title:spec.label+' — cole o valor de "'+s.label+'" (fica no cofre local do Jarvis; vazio = usar uma env var existente):',input:true,placeholder:'cole o token…',okText:'Continuar'});
          if(v==null) return;
          if(v.trim()){ const name=mkName(i?String(i+1):''); refs[s.key]=name; pending.push({name,value:v.trim()}); }
          else { const ref=await dialog({title:spec.label+' — NOME da env var já existente com "'+s.label+'":',input:true,placeholder:'EX.: GH_ACME_TOKEN',okText:'Salvar'}); if(ref==null||!ref.trim()) return; refs[s.key]=ref.trim(); }
        }
        pending.forEach(sec=>tx({t:'secret_set',name:sec.name,value:sec.value}));
        tx({t:'task_connection_save',connection:{provider:spec.id,label:label.trim(),config,secretRef:refs.secretRef,secretRef2:refs.secretRef2}});
        toast('Conexão salva — use "Verificar" para confirmar a identidade.');
      };
      p.appendChild(add);
      p.addEventListener('click',async(e)=>{
        const sec=e.target.closest&&e.target.closest('.wfc-secret');
        if(sec){
          const c=(wfConnections||[]).find(x=>x.id===sec.dataset.id); if(!c) return;
          closePop();
          const v=await dialog({title:'Cole o segredo de "'+c.label+'" ('+c.secretRef+'). Vai para o cofre local e vale na hora — sem restart:',input:true,placeholder:'cole o token…',okText:'Salvar'});
          if(v!=null&&v.trim()){ tx({t:'secret_set',name:c.secretRef,value:v.trim()}); toast('Segredo salvo no cofre — verifique a identidade.'); }
          if(c.secretRef2){ const v2=await dialog({title:'Segundo segredo ('+c.secretRef2+') — vazio mantém o atual:',input:true,okText:'Salvar'}); if(v2!=null&&v2.trim()) tx({t:'secret_set',name:c.secretRef2,value:v2.trim()}); }
          return;
        }
        const v=e.target.closest&&e.target.closest('.wfc-verify'); if(v){ tx({t:'task_connection_verify',id:v.dataset.id}); toast('Verificando identidade…'); return; }
        const del=e.target.closest&&e.target.closest('.wfc-del'); if(del){ tx({t:'task_connection_delete',id:del.dataset.id}); return; }
      });
    }
    // ── Tarefa no fluxo (F1): colar chave/URL, escolher arquivo local de feature, e a fonte do
    // projeto (lembrada por pasta). A tarefa ARMADA vale para o próximo fluxo iniciado na sessão.
    function buildWfTaskSection(p){
      if(authUser&&authUser.role==='owner'&&wfConnections===null){ wfConnections=[]; tx({t:'task_connections'}); }
      p.appendChild(ph('Tarefa'));
      const arm=wfTaskArmGet();
      const info=document.createElement('div'); info.className='mut'; info.style.cssText='font-size:11.5px;padding:2px 2px 6px;max-width:280px';
      info.textContent=arm?('Armada: '+(arm.label||arm.input||'')+' — vale para o próximo fluxo iniciado'):(wfRun&&wfRun.task&&wfRun.task.key?('Atual: '+(wfRun.taskLabel||wfRun.task.key)):'Cole uma chave/URL ou escolha um arquivo de feature.');
      p.appendChild(info);
      const row=document.createElement('div'); row.style.cssText='display:flex;gap:6px;padding:0 2px 6px';
      const inp=document.createElement('input'); inp.type='text'; inp.placeholder='PRI-824 · URL do Jira/GitHub/Linear'; inp.style.cssText='flex:1;min-width:120px'; if(arm&&arm.input)inp.value=arm.input;
      const ok=document.createElement('button'); ok.type='button'; ok.className='wfact'; ok.textContent=arm?'Rearmar':'Armar';
      ok.onclick=()=>{ const v=inp.value.trim(); wfTaskArmSet(v?{input:v,label:v}:null); closePop(); toast(v?'Tarefa armada para o próximo fluxo.':'Tarefa desarmada.'); };
      inp.onkeydown=(ev)=>{ if(ev.key==='Enter'){ ev.preventDefault(); ok.onclick(); } };
      row.appendChild(inp); row.appendChild(ok); p.appendChild(row);
      const lf=document.createElement('button'); lf.type='button'; lf.className='opt';
      lf.innerHTML='📄 Arquivos de feature <span class="r">'+esc(wfLocalDir)+'</span>';
      lf.onclick=()=>{ wfLocalShow=true; tx({t:'task_local_list',sessionId:currentSession}); };
      p.appendChild(lf);
      // Atualizar: o Hub serve a lista de um cache invalidado por assinatura da pasta, e existe caso
      // em que o mtime nao basta (drive de rede, dois writes no mesmo tick). O pedido explicito e a saida.
      if(wfLocalShow){ const rf=document.createElement('button'); rf.type='button'; rf.className='wfact'; rf.style.cssText='margin:0 2px 6px';
        rf.textContent='Atualizar lista'; rf.title='Reler os arquivos de feature agora, ignorando o cache';
        rf.onclick=(ev)=>{ ev.stopPropagation(); tx({t:'task_local_list',sessionId:currentSession,refresh:true}); };
        p.appendChild(rf); }
      if(wfLocalShow&&wfLocalFiles){
        if(!wfLocalFiles.length){ const d=document.createElement('div'); d.className='mut'; d.style.cssText='font-size:11.5px;padding:0 2px 6px'; d.textContent='Nenhum .md em '+wfLocalDir+'.'; p.appendChild(d); }
        wfLocalFiles.slice(0,30).forEach(f=>{
          const b=document.createElement('button'); b.type='button'; b.className='opt';
          b.innerHTML='• '+esc(f.title)+' <span class="r mono" style="font-size:10px">'+esc(f.key.split('/').pop())+'</span>';
          b.onclick=()=>{ wfLocalShow=false; wfTaskArmSet({task:{tracker:'local',key:f.key,title:f.title},meta:{description:f.description||''},label:f.title}); closePop(); toast('Tarefa armada: '+f.title); };
          p.appendChild(b);
        });
      }
      p.appendChild(ph('Fonte do projeto'));
      const srcRow=document.createElement('div'); srcRow.style.cssText='display:flex;gap:4px;flex-wrap:wrap;padding:2px 2px 8px';
      ['local','github','jira','linear',''].forEach(src=>{
        const b=document.createElement('button'); b.type='button'; b.className='wfact';
        const on=((wfTaskBinding&&wfTaskBinding.tracker)||'')===src;
        if(on) b.style.cssText='outline:1px solid var(--accent,#6ea8fe)';
        b.textContent=src||'nenhuma'; b.title='Fonte de tarefas deste projeto — lembrada por pasta (ex.: projeto X usa Jira, Y usa GitHub)';
        b.onclick=()=>{ wfTaskBinding={tracker:src,featuresDir:wfTaskBinding&&wfTaskBinding.featuresDir}; tx({t:'task_binding_set',sessionId:currentSession,tracker:src,featuresDir:wfTaskBinding.featuresDir||undefined}); toast('Fonte do projeto: '+(src||'nenhuma')); };
        srcRow.appendChild(b);
      });
      p.appendChild(srcRow);
      // Conexão do projeto (C2) + busca no provedor (C4). Só aparece quando a fonte é um provedor.
      const trackerNow=(wfTaskBinding&&wfTaskBinding.tracker)||'';
      if(trackerNow&&trackerNow!=='local'){
        const conn=(wfConnections||[]).find(c=>c.id===(wfTaskBinding&&wfTaskBinding.connectionId));
        const cRow=document.createElement('div'); cRow.style.cssText='padding:2px 2px 6px;font-size:12px;max-width:300px';
        cRow.innerHTML='🔐 '+(conn?('<b>'+esc(conn.label)+'</b> <span class="mut">'+esc(conn.identity?('@'+conn.identity.login):'não verificada')+(conn.envOk?'':' · ⚠ env')+'</span>'):'<span style="color:#f5b544">sem conexão vinculada — escolha a conta</span>');
        p.appendChild(cRow);
        const bRow=document.createElement('div'); bRow.style.cssText='display:flex;gap:4px;flex-wrap:wrap;padding:0 2px 6px';
        const mkb=(txt,fn,title)=>{ const b=document.createElement('button'); b.type='button'; b.className='wfact'; b.textContent=txt; if(title)b.title=title; b.onclick=fn; bRow.appendChild(b); };
        const candidates=(wfConnections||[]).filter(c=>c.provider===trackerNow);
        mkb(conn?'trocar conexão':'vincular conexão',async()=>{
          if(!candidates.length){ toast('Nenhuma conexão de '+trackerNow+' no cofre — adicione em ⚙.'); return; }
          closePop();
          const pick=await dialog({title:'Qual conexão para ESTE projeto?\n\n'+candidates.map((c,i)=>(i+1)+'. '+c.label+' ('+(c.identity?('@'+c.identity.login):'não verificada')+')').join('\n'),input:true,placeholder:'número',okText:'Vincular'});
          if(pick==null) return; const chosen=candidates[parseInt(pick,10)-1]; if(!chosen){ toast('Opção inválida'); return; }
          tx({t:'task_binding_set',sessionId:currentSession,tracker:trackerNow,connectionId:chosen.id,featuresDir:(wfTaskBinding&&wfTaskBinding.featuresDir)||undefined,target:(wfTaskBinding&&wfTaskBinding.target)||undefined,autoApprove:(wfTaskBinding&&wfTaskBinding.autoApprove)||undefined});
        },'A conta que ESTE projeto usa (regra de ouro: sem vínculo, nada de escrita)');
        mkb('destino: '+((wfTaskBinding&&wfTaskBinding.target)||'—'),async()=>{
          closePop();
          const spec=(wfProviders||[]).find(x=>x.id===trackerNow);
          const v=await dialog({title:'Destino de ESCRITA neste projeto ('+((spec&&spec.targetHint)||'destino')+'):',input:true,value:(wfTaskBinding&&wfTaskBinding.target)||'',okText:'Salvar'});
          if(v==null) return;
          tx({t:'task_binding_set',sessionId:currentSession,tracker:trackerNow,connectionId:(wfTaskBinding&&wfTaskBinding.connectionId)||undefined,featuresDir:(wfTaskBinding&&wfTaskBinding.featuresDir)||undefined,target:v.trim()||undefined,autoApprove:(wfTaskBinding&&wfTaskBinding.autoApprove)||undefined});
        },'Onde criar tarefas (owner/repo, chave do projeto Jira, chave do time Linear)');
        const auto=!!(wfTaskBinding&&wfTaskBinding.autoApprove&&wfTaskBinding.autoApprove.includes('create'));
        mkb('criar sem aprovar: '+(auto?'ON':'off'),()=>{
          tx({t:'task_binding_set',sessionId:currentSession,tracker:trackerNow,connectionId:(wfTaskBinding&&wfTaskBinding.connectionId)||undefined,featuresDir:(wfTaskBinding&&wfTaskBinding.featuresDir)||undefined,target:(wfTaskBinding&&wfTaskBinding.target)||undefined,autoApprove:auto?[]:['create']});
          toast(auto?'Criação volta a pedir aprovação neste projeto.':'Criação liberada NESTE projeto (divergência de conta ainda pede aprovação).');
        },'Política adaptativa por projeto+ação: libera criar tarefa sem aprovação AQUI');
        mkb('⚙',()=>{ wfConnManage=true; closePop(); togglePop(E.wfStepBtn,buildWfStepPop); },'Gerenciar o cofre de conexões');
        p.appendChild(bRow);
        if(conn){
          const sRow=document.createElement('div'); sRow.style.cssText='display:flex;gap:6px;padding:0 2px 6px';
          const sInp=document.createElement('input'); sInp.type='text'; sInp.placeholder='🔎 buscar em '+esc(conn.label); sInp.style.cssText='flex:1;min-width:120px';
          const sBtn=document.createElement('button'); sBtn.type='button'; sBtn.className='wfact'; sBtn.textContent='Buscar';
          sBtn.onclick=()=>{ const q=sInp.value.trim(); if(!q) return; wfSearchResults={busy:true}; tx({t:'task_search',sessionId:currentSession,query:q}); toast('Buscando em '+conn.label+'…'); };
          sInp.onkeydown=(ev)=>{ if(ev.key==='Enter'){ ev.preventDefault(); sBtn.onclick(); } };
          sRow.appendChild(sInp); sRow.appendChild(sBtn); p.appendChild(sRow);
          const sr=wfSearchResults;
          if(sr&&!sr.busy&&sr.sessionId===currentSession){
            if(sr.error){ const d=document.createElement('div'); d.className='mut'; d.style.cssText='font-size:11.5px;padding:0 2px 6px;color:#f5b544'; d.textContent=sr.error; p.appendChild(d); }
            (sr.results||[]).slice(0,8).forEach(it=>{
              const b=document.createElement('button'); b.type='button'; b.className='opt';
              b.innerHTML=esc(it.key)+' · '+esc(String(it.title||'').slice(0,60))+(it.state?' <span class="r">'+esc(it.state)+'</span>':'');
              b.onclick=()=>{ wfSearchResults=null; wfTaskArmSet({task:{tracker:it.tracker,key:it.key,title:it.title,url:it.url},meta:{title:it.title,description:it.description||'',url:it.url||''},label:it.key+' · '+it.title}); closePop(); toast('Tarefa armada: '+it.key); };
              p.appendChild(b);
            });
          }
        }
      }
      const mine=wfSessionRuns();
      if(mine.length>1){
        p.appendChild(ph('Tarefas desta sessão'));
        mine.forEach(r=>{
          const sel=wfRun&&wfRun.runId===r.runId, s=r.summary||{};
          const b=document.createElement('button'); b.type='button'; b.className='opt'+(sel?' sel':''); b.setAttribute('aria-pressed',String(sel));
          b.innerHTML=esc(r.taskLabel||r.workflowName)+' <span class="r">'+(sel?'em foco':((s.done||0)+'/'+(s.total||0)))+'</span>';
          b.onclick=()=>{ if(!sel) tx({t:'workflow_run_focus',runId:r.runId,sessionId:currentSession}); closePop(); };
          p.appendChild(b);
        });
      }
    }
    // Uma linha de passo. Mesma peça nos dois modos (escolher onde entrar × ver onde estou), porque é a
    // mesma decisão: "o que este envio ataca". O estado só aparece quando existe run.
    function wfStepOption(def,s,i){
      const noRun=wfRun&&wfRun.workflowId===def.id;
      const sel=noRun&&wfRun.currentStepId===s.id;
      const estado=noRun?(((wfRun.steps||[]).find(x=>x.id===s.id)||{}).state||''):'';
      const b=document.createElement('button'); b.type='button'; b.className='opt'+(sel?' sel':''); b.setAttribute('aria-pressed',String(sel));
      b.innerHTML='<span class="mut" style="flex:none;width:16px;text-align:right;font-size:11px">'+(i+1)+'</span>'
        +'<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(s.title)+'</span>'
        +(s.kind==='gate'?'<span class="wfbadge">gate</span>':'')
        +(s.requiresEvidence?'<span class="wfbadge">evid</span>':'')
        +(sel?'<span class="r">em foco</span>':estado==='done'?'<span class="r">✓ feito</span>':estado==='skipped'?'<span class="r">⤼ pulado</span>':'');
      // O hint é o que o passo espera de você — no seletor ele vale mais como tooltip do que o id.
      b.title=(s.hint?s.hint+'\n\n':'')+(wfRun?'Passar o foco para este passo':'Iniciar o fluxo já neste passo');
      b.onclick=()=>wfPickStep(def.id,s.id);
      return b;
    }
    // Sem fluxo: ESCOLHER um. Antes isto era um diálogo pedindo o número do fluxo por teclado, e o
    // seletor despejava todos os passos de todos os fluxos numa lista só, sem dizer de quem era cada um.
    function buildWfStartPop(p,defs){
      p.appendChild(ph('Iniciar um fluxo'));
      defs.forEach(def=>{
        const steps=def.steps||[];
        const aberto=wfPickOpen===null?defs.length===1:wfPickOpen===def.id;
        const head=document.createElement('button'); head.type='button'; head.className='opt';
        head.innerHTML='<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><b>'+esc(def.name||def.id)+'</b></span>'
          +'<span class="r">'+steps.length+' passos</span>';
        head.title='Iniciar este fluxo no primeiro passo';
        head.onclick=()=>wfPickStep(def.id,(steps[0]||{}).id);
        p.appendChild(head);
        const more=document.createElement('button'); more.type='button'; more.className='opt';
        more.style.cssText='font-size:11.5px;padding:2px 9px 6px;color:var(--mut,#8ea0b5)';
        more.textContent=(aberto?'▾':'▸')+' entrar direto num passo';
        more.title='Você já está no meio do trabalho: comece o acompanhamento no passo certo';
        more.onclick=()=>{ wfPickOpen=aberto?'':def.id; replaceOpenPop(E.wfStepBtn,buildWfStepPop); };
        p.appendChild(more);
        if(aberto) steps.forEach((s,i)=>p.appendChild(wfStepOption(def,s,i)));
      });
    }
    // Com fluxo: ONDE ESTOU. Só os passos DESTE fluxo, com estado; os outros fluxos viram uma linha cada.
    function buildWfRunPop(p,defs){
      const def=defs.find(d=>d.id===wfRun.workflowId)||{id:wfRun.workflowId,steps:wfRun.steps||[]};
      p.appendChild(ph(wfRun.workflowName||wfRun.workflowId));
      (def.steps||[]).forEach((s,i)=>p.appendChild(wfStepOption(def,s,i)));
      // Sair é opção do MESMO menu em que se entra. Escolher um passo era caminho só de ida: o
      // acompanhamento colava na sessão (e no prompt de todo turno) sem porta de saída à vista.
      const off=document.createElement('button'); off.type='button'; off.className='opt';
      off.style.cssText='border-top:1px solid rgba(127,127,127,.25);margin-top:4px;padding-top:8px';
      off.innerHTML='✖ Parar de acompanhar';
      off.title='Encerra o acompanhamento: a faixa some e o fluxo deixa de entrar no turno da IA.';
      off.onclick=()=>{ closePop(); wfStopRun('abandon'); };
      p.appendChild(off);
      const outros=defs.filter(d=>d.id!==wfRun.workflowId);
      if(outros.length){
        p.appendChild(ph('Outros fluxos'));
        outros.forEach(d=>{
          const b=document.createElement('button'); b.type='button'; b.className='opt';
          b.innerHTML='<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(d.name||d.id)+'</span><span class="r">'+((d.steps||[]).length)+' passos</span>';
          b.title='Iniciar este outro fluxo (abre um acompanhamento novo nesta sessão)';
          b.onclick=()=>wfPickStep(d.id,((d.steps||[])[0]||{}).id);
          p.appendChild(b);
        });
      }
    }
    // A tarefa é OPCIONAL e vinha primeiro, empurrando o fluxo (o assunto do menu) para baixo de um
    // formulário de ticket, conexões e cofre. Agora é uma gaveta fechada, com o estado atual no rótulo.
    function buildWfTaskDisclosure(p){
      const arm=wfTaskArmGet();
      const resumo=arm?('armada: '+(arm.label||arm.input||''))
        :(wfRun&&wfRun.task&&wfRun.task.key?('atual: '+(wfRun.taskLabel||wfRun.task.key)):'nenhuma');
      const b=document.createElement('button'); b.type='button'; b.className='opt';
      b.style.cssText='border-top:1px solid rgba(127,127,127,.25);margin-top:6px;padding-top:8px;font-size:12px';
      b.innerHTML=(wfTaskOpen?'▾':'▸')+' 🎯 Tarefa <span class="r">'+esc(resumo)+'</span>';
      b.title='Vincular este fluxo a um ticket ou arquivo de feature — opcional';
      b.onclick=()=>{ wfTaskOpen=!wfTaskOpen; replaceOpenPop(E.wfStepBtn,buildWfStepPop); };
      p.appendChild(b);
      if(wfTaskOpen) buildWfTaskSection(p);
    }
    function buildWfStepPop(p){
      // A âncora existe SEMPRE (é por ela que o popup se redesenha quando chegam as conexões), mesmo
      // com a gaveta de tarefa fechada.
      const anchor=document.createElement('span'); anchor.className='wftask-anchor'; anchor.style.display='none'; p.appendChild(anchor);
      if(wfConnManage){ buildWfConnManage(p); return; }   // no modo gerenciar, o popup é só o cofre
      if(!currentSession){ const d=document.createElement('div'); d.className='mut'; d.style.cssText='font-size:11.5px;padding:2px'; d.textContent='Abra uma sessão para acompanhar um fluxo.'; p.appendChild(d); return; }
      const defs=wfDefs||[];
      if(!defs.length){
        p.appendChild(ph('Fluxo'));
        const d=document.createElement('div'); d.className='mut'; d.style.cssText='font-size:11.5px;padding:2px;max-width:280px';
        d.textContent='Nenhum fluxo salvo. Crie um em Configurações → Framework → Fluxos.';
        p.appendChild(d); return;
      }
      if(wfRun) buildWfRunPop(p,defs); else buildWfStartPop(p,defs);
      buildWfTaskDisclosure(p);
    }
    if(E.wfStepBtn) E.wfStepBtn.onclick=()=>togglePop(E.wfStepBtn,buildWfStepPop);
    function wfBusyNow(){ return busy(currentSession); }
    // Encerrar o acompanhamento — a saída que faltava. `finish` = o fluxo chegou ao fim; `abandon` =
    // não quero este fluxo nesta sessão. O efeito imediato é o mesmo (sai da faixa e para de entrar no
    // turno da IA); a diferença fica registrada no run. Confirma porque iniciar de novo nasce do zero:
    // um run encerrado não volta a ser o acompanhamento da sessão.
    async function wfStopRun(op){
      if(!wfRun) return;
      const nome=wfRun.workflowName||wfRun.workflowId;
      // O run é do FLUXO, não da sessão: encerrar vale para toda sessão vinculada a ele (multi-tarefa).
      // Prometer "só aqui" seria mentira na única situação em que a diferença importa.
      const outras=Math.max(0,((wfRun.sessions||[]).length)-1);
      const alcance=outras?(' Ele está vinculado a mais '+outras+' sessão(ões) — encerra em todas.'):'';
      const ok=await dialog(op==='finish'
        ? {title:'Concluir o fluxo “'+nome+'”?\n\nEle sai da faixa e deixa de entrar no turno da IA. Os passos ficam registrados como estão.'+alcance,okText:'Concluir'}
        : {title:'Parar de acompanhar o fluxo “'+nome+'”?\n\nEle sai da faixa e deixa de entrar no turno da IA. Dá para iniciar de novo depois, mas o acompanhamento nasce do zero.'+alcance,okText:'Parar',danger:true});
      if(!ok) return;
      tx({t:'workflow_run_update',runId:wfRun.runId,sessionId:currentSession,op});
      toast(op==='finish'?'Fluxo concluído.':'Fluxo encerrado.');
    }
    // Início do acompanhamento (F2): escolhe o fluxo salvo e a tarefa — referência AGNÓSTICA
    // (linear, github, jira, o que for; pode até ficar sem rastreador).
    // ATENÇÃO: nada de prompt()/confirm() nativos aqui — no shell desktop (Electron) eles não existem
    // e o clique morre em silêncio. Usar sempre o dialog() do app.
    if(E.wfRun) E.wfRun.addEventListener('click',async e=>{
      if(e.target.closest('.wf-dismiss')){ wfHideSuggest=true; renderWfRun(); return; }
      if(e.target.closest('.wf-restore')){ wfHideSuggest=false; renderWfRun(); return; }
      if(!wfRun) return;
      if(e.target.closest('.wf-tog')){ wfOpen=!wfOpen; renderWfRun(); return; }
      const foc=e.target.closest('.wf-focus'); if(foc){ tx({t:'workflow_run_focus',runId:foc.dataset.run,sessionId:currentSession}); return; }
      if(e.target.closest('.wf-sum')){ if(wfRun.task&&wfRun.task.key){ tx({t:'task_summarize',tracker:wfRun.task.tracker||'',key:wfRun.task.key}); toast('Resumindo a tarefa…'); } return; }
      if(e.target.closest('.wf-stop')){ wfStopRun('abandon'); return; }
      if(e.target.closest('.wf-finish')){ wfStopRun('finish'); return; }
      const upd=(op,extra)=>tx(Object.assign({t:'workflow_run_update',runId:wfRun.runId,sessionId:currentSession,op},extra||{}));
      // Ponto da trilha: foca a fase. Não pede confirmação porque não destrói nada — nenhum passo muda
      // de estado, e um clique errado se desfaz com outro clique.
      const dot=e.target.closest('.wfph'); if(dot){ upd('focus',{stepId:dot.dataset.id}); return; }
      if(e.target.closest('.wf-adv')){ if(wfBusyNow()){ toast('Aguarde o turno terminar para avançar.'); return; } upd('advance'); return; }
      const ev=e.target.closest('.wf-ev'); if(ev){ const v=await dialog({title:'Evidência (link ou descrição) para este passo:',input:true,placeholder:'https://… ou uma descrição',okText:'Anexar'}); if(v&&String(v).trim()) upd('evidence',{stepId:ev.dataset.id,kind:/^https?:\/\//i.test(String(v).trim())?'link':'text',value:String(v).trim()}); return; }
      const mk=e.target.closest('.wf-mark'); if(mk){ const st=(wfRun.steps||[]).find(x=>x.id===mk.dataset.id); upd('mark',{stepId:mk.dataset.id,state:st&&st.state==='done'?'pending':'done'}); return; }
      const row=e.target.closest('.wfs'); if(row){
        if(wfBusyNow()){ toast('Não dá para mudar de fase com um turno em execução.'); return; }
        const steps=wfRun.steps||[], target=steps.findIndex(x=>x.id===row.dataset.id);
        const nextIdx=steps.findIndex(x=>x.state==='pending');
        const pulados=nextIdx>=0&&target>nextIdx?steps.slice(0,target).filter(x=>x.state==='pending').length:0;
        if(pulados && !(await dialog({title:'Isso pula '+pulados+' passo(s) que ficarão registrados como PULADOS (não como feitos). Continuar?',okText:'Pular',cancelText:'Cancelar'}))) return;
        upd('jump',{stepId:row.dataset.id});
      }
    });
    // Indicador de jobs em background (comandos ```jarvis-run```): visível em QUALQUER sessão, mostra o
    // que está rodando/na fila + recém-concluídos, com "ir" (navega até a sessão dona) e "cancelar".
    let bgJobsCache=[], bgJobsOpen={}; // jobId -> saida expandida (sobrevive ao re-render do poll)
    function renderBgJobs(jobs){
      if(jobs)bgJobsCache=jobs; if(!E.bgJobs) return;
      const list=bgJobsCache||[];
      E.bgJobs.innerHTML=''; E.bgJobs.classList.toggle('hidden',!list.length); if(!list.length) return;
      const ICON={queued:'⏳',running:'⚙️',succeeded:'✓',failed:'✗',cancelled:'⛔'};
      const LABEL={queued:'na fila',running:'rodando',succeeded:'concluído',failed:'falhou',cancelled:'cancelado'};
      // Com vários jobs terminados na tela, fechar um a um é pior que o problema original.
      const prontos=list.filter(j=>j.status!=='running'&&j.status!=='queued').length;
      if(prontos>1){ const hdr=document.createElement('div'); hdr.className='bgj';
        const s=document.createElement('span'); s.className='bgj-cmd'; s.textContent=prontos+' job(s) concluído(s) no painel';
        const all=document.createElement('button'); all.type='button'; all.className='bgj-act'; all.textContent='fechar concluídos'; all.title='Tirar do painel todos os jobs que já terminaram';
        all.onclick=()=>tx({t:'background_job_dismiss',jobId:'*'});
        hdr.append(s,all); E.bgJobs.appendChild(hdr); }
      list.forEach(j=>{
        const row=document.createElement('div'); row.className='bgj'+((j.status==='running'||j.status==='queued')?' run':'');
        const ic=document.createElement('span'); ic.className='bgj-ic'; ic.textContent=ICON[j.status]||'•'; if(j.status==='succeeded')ic.style.color='#4ade80'; else if(j.status==='failed')ic.style.color='#f87171'; else if(j.status==='cancelled')ic.style.color='#f0883e';
        const cmd=document.createElement('span'); cmd.className='bgj-cmd'; cmd.textContent='job '+(LABEL[j.status]||j.status)+(j.status==='failed'&&j.exitCode!=null?' ('+j.exitCode+')':'')+': '+(j.command||''); cmd.title=j.command||'';
        row.append(ic,cmd);
        // "terminou, mas continuou a conversa?" era invisível — e é justamente a duvida de quem espera
        // um turno que talvez nunca venha. Terminal sem continuacao ganha selo de alerta.
        if(j.status!=='running'&&j.status!=='queued'){
          const s=document.createElement('span'); s.className='bgj-cont'+(j.continued?'':' warn');
          s.textContent=j.continued?'✓ resultado devolvido':'⚠ nao continuou';
          s.title=j.continued?'O Jarvis abriu um turno na sessao com o resultado deste job.':'O job terminou mas nenhum turno foi aberto com o resultado. Abra a sessao e use a saida abaixo.';
          row.appendChild(s);
        }
        // "ir" não dizia para onde. O botão abre a SESSÃO dona do job — útil enquanto roda e depois de
        // terminar (é lá que o resultado foi devolvido), então o rótulo passa a dizer isso.
        const vivo=(j.status==='running'||j.status==='queued');
        const go=document.createElement('button'); go.type='button'; go.className='bgj-act'; go.textContent='abrir sessão'; go.title='Abrir a sessão dona deste job'; go.onclick=()=>{ if(j.sessionId) openSession(j.sessionId,j.runnerId); }; row.appendChild(go);
        if(vivo){ const x=document.createElement('button'); x.type='button'; x.className='bgj-act danger'; x.textContent='cancelar'; x.title='Cancelar este job'; x.onclick=()=>{ if(confirm('Cancelar este job em background?')) tx({t:'background_job_cancel',jobId:j.jobId}); }; row.appendChild(x); }
        // Job terminado só sumia quando a janela de retenção expirava — não havia como tirar da frente.
        else { const d=document.createElement('button'); d.type='button'; d.className='bgj-act'; d.textContent='fechar'; d.title='Tirar este job concluído do painel (não cancela nem desfaz nada)'; d.onclick=()=>tx({t:'background_job_dismiss',jobId:j.jobId}); row.appendChild(d); }
        E.bgJobs.appendChild(row);
        // Saida: ao vivo enquanto roda (a cauda anda a cada poll), e o resumo final depois. Colapsado
        // por padrao para nao empurrar o chat; o estado de aberto sobrevive ao re-render.
        if(j.output){
          const d=document.createElement('details'); d.className='bgj-out'; d.open=!!bgJobsOpen[j.jobId];
          d.addEventListener('toggle',()=>{ if(d.open)bgJobsOpen[j.jobId]=1; else delete bgJobsOpen[j.jobId]; });
          const sm=document.createElement('summary'); sm.textContent=(j.status==='running'?'saida ao vivo':'saida final');
          const pre=document.createElement('pre'); pre.textContent=j.output;
          d.append(sm,pre); E.bgJobs.appendChild(d);
          // Enquanto roda, mantem a cauda colada no fim (comportamento de terminal).
          if(d.open&&j.status==='running') pre.scrollTop=pre.scrollHeight;
        }
      });
    }
    function renderQueue(){ if(!E.queueRow)return; const q=queueOf(currentSession); E.queueRow.innerHTML=''; E.queueRow.classList.toggle('hidden',!q.length); if(!q.length)return;
      // Motivo do travamento vindo do Hub. Enquanto ele existir, a barra diz POR QUE a fila não saiu
      // em vez de prometer que "roda automaticamente agora" — que era falso justamente quando importava.
      const blk=queueBlockBySession[sessionStateKey(currentSession,currentSessionRunner)];
      const waiting=busy(currentSession)?'rodam automaticamente quando este turno terminar':'rodam automaticamente agora';
      const hdr=document.createElement('div'); hdr.className='qhdr'; const s=document.createElement('span');
      if(blk&&blk.reason){ const mins=Math.max(0,Math.round((Date.now()-(blk.since||Date.now()))/60000));
        s.textContent='⏳ '+q.length+' na fila — parada: '+blk.reason+(mins>=1?(' (há '+mins+' min')+(blk.attempts>1?', '+blk.attempts+' tentativas':'')+')':'');
        s.title='Código: '+(blk.code||'?')+'. O Hub reavalia a cada 15s.'; hdr.classList.add('qstuck'); }
      else s.textContent='⏳ '+q.length+' na fila — '+waiting;
      hdr.appendChild(s);
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
        const x=document.createElement('button'); x.type='button'; x.className='qx'; x.title='Remover'; x.textContent='✕'; x.onclick=(e)=>{ e.stopPropagation(); const it=q[i]; q.splice(i,1); renderQueue(); tx({t:'dequeue',sessionId:currentSession,msgId:it&&it.msgId,index:i}); }; head.appendChild(x);
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
    E.composer.onsubmit=(e)=>{ e.preventDefault(); const text=E.input.value.trim(); if(!text&&!attachments.length)return; setComposerOptionsOpen(false);
      // "#note" → append to the project memory file (CLAUDE.md/AGENTS.md), confirmed. Not a turn.
      if(text.startsWith('#')){ const note=text.replace(/^#+\s*/,'').trim(); if(!note) return; closeTrig();
        tx({t:'memory_preview',text:note,sessionId:currentSession}); status('busy','Preparando prévia da memória…');
        return; }
      // Espaço de Soluções armado: o envio do chat É o objetivo da rodada, não um turno normal. Sai antes
      // do "!" (comando) e da fila — uma rodada não entra na fila do turno, ela abre execuções próprias.
      if(solutionArmed()&&text&&solutionUsable()){ closeTrig();
        E.input.value=''; E.input.style.height='auto';
        if(currentSession){ delete draftBySession[sessionStateKey(currentSession,currentSessionRunner)]; saveDrafts(); }
        // council_start/tournament_start não carregam anexo: em vez de sumir com eles em silêncio, ficam
        // no composer e a rodada avisa que foram deixados de fora.
        if(attachments.length) toast('Anexos não entram numa rodada de Soluções — ficaram no composer.');
        startSolutionRound(text); syncComposerActions();
        return; }
      // Debate em andamento nesta sessão: o envio é um RECADO para a próxima rodada, não um turno novo.
      // Vem DEPOIS do Espaço de Soluções (armar uma rodada é um ato explícito e ganha) e ANTES da fila:
      // recado não espera o turno atual terminar — ele é para o debate, que roda em paralelo.
      // "!" fica de fora: executa shell, e engolir isso como recado seria perder o comando em silêncio.
      if(debateLive(currentSession)&&!text.startsWith('!')){ closeTrig();
        // Só anexo, sem texto: um recado é texto. Melhor recusar dizendo o motivo do que mandar
        // "(anexo)" como recado e descartar o arquivo sem avisar.
        if(!text){ toast('Debate em andamento — um recado precisa de texto (anexos não entram numa rodada).'); return; }
        E.input.value=''; E.input.style.height='auto';
        if(currentSession){ delete draftBySession[sessionStateKey(currentSession,currentSessionRunner)]; saveDrafts(); }
        if(attachments.length) toast('Anexos não entram num recado ao debate — ficaram no composer.');
        tx({t:'debate_say',sessionId:currentSession,text});
        syncComposerActions();
        return; }
      if(text.startsWith('!')) pushBang(text.slice(1).split('\n')[0].trim());   // guarda no histórico do "!"
      const atts=attachments.slice(); E.input.value=''; E.input.style.height='auto'; attachments=[]; if(currentSession) delete attachmentsBySession[sessionStateKey(currentSession,currentSessionRunner)]; renderAttach();
      if(currentSession){ delete draftBySession[sessionStateKey(currentSession,currentSessionRunner)]; saveDrafts(); }   // o texto saiu do composer (enviado/enfileirado) → não é mais rascunho
      if(busy(currentSession)){ const mid=uid(); queueOf(currentSession).push({text:text||'(anexo)',atts,msgId:mid}); renderQueue(); bumpSession(currentSession); tx({t:'enqueue',sessionId:currentSession,text:text||'(anexo)',attachments:atts,model:curModel,effort:curEffort,permissionMode:curMode||undefined,auto:routeAutoFor(currentSession),msgId:mid}); return; }
      setRestorable(currentSession,text,atts); sendMsgTo(currentSession,text||'(anexo)',atts); };
    E.stopBtn.onclick=()=>{
      stopTTS();   // parar o turno também silencia qualquer áudio em reprodução
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
      // The universal Framework Jarvis (agent:'jarvis') is offered under EVERY AI, alongside the active
      // adapter's own commands — even when the adapter has no native command system.
      let arr=cmdList.filter(c=> c.agent==='jarvis' || (ag && c.agent===ag));
      arr=arr.filter(c=> !q || c.name.toLowerCase().includes(q) || (c.description||'').toLowerCase().includes(q));
      arr.sort((a,b)=>{ const ap=a.name.toLowerCase().startsWith(q)?0:1, bp=b.name.toLowerCase().startsWith(q)?0:1; return ap-bp || a.name.localeCompare(b.name); });
      return arr.slice(0,50); }
    const kindBadge=(k)=> k==='skill'?'skill':k==='mcp'?'mcp':k==='builtin'?'built-in':'cmd';
    function renderTrig(){
      if(!trigItems.length){ E.cmdPop.innerHTML='<div class="cmdempty">'+(trigMode==='file'?'Nenhum arquivo.':'Nenhum comando/skill.')+'</div>'; E.cmdPop.classList.remove('hidden'); return; }
      const rows=trigItems.map((it,i)=> trigMode==='file'
        ? '<div class="cmdit'+(i===trigIdx?' sel':'')+'" data-i="'+i+'"><span class="cn">📄 '+esc(it)+'</span></div>'
        : '<div class="cmdit'+(i===trigIdx?' sel':'')+'" data-i="'+i+'"><span class="cn">/'+esc(it.name)+'</span><span class="ck">'+kindBadge(it.kind)+'</span>'+(it.agent==='jarvis'?'<span class="csrc">universal</span>':'')+'<span class="cd">'+esc(it.description||it.argHint||'')+'</span></div>');
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
      // Se o MESMO nome existe no framework universal e na instalação nativa da IA, insere a origem
      // escolhida (`/jarvis:nome` ou `/native:nome`) — senão a escolha do menu se perderia e quem
      // decidiria seria só a preferência global, silenciosamente (foi assim que uma skill importada
      // ficou sombreada por uma versão nativa antiga).
      const homonym=(cmdList||[]).some(c=>c.name===it.name&&(c.agent==='jarvis')!==(it.agent==='jarvis'));
      const token=homonym?((it.agent==='jarvis'?'jarvis:':'native:')+it.name):it.name;
      E.input.value=v.slice(0,at.start)+'/'+token+' '+v.slice(at.end); closeTrig(); E.input.dispatchEvent(new Event('input')); try{E.input.focus();}catch(e){} }

    E.input.oninput=()=>{ E.input.style.height='auto'; E.input.style.height=E.input.scrollHeight+'px'; syncComposerActions(); if(currentSession) draftBySession[sessionStateKey(currentSession,currentSessionRunner)]=E.input.value; updateTrig(); updateSolutionCount(); };
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
    window.addEventListener('pagehide', ()=>{ stashDraft(); });   // último recurso antes do unload/descarte
    setSpeakBtn(); connect();
