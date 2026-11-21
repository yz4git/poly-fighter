(async function captureAudit() {
  const { spawn } = await import("node:child_process");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const port = 9518, out = process.env.CMU_AUDIT_DIR ?? "artifacts/cmu-visual";
  const driver = process.env.WEBDRIVER_BIN;
  const url = process.env.AUDIT_URL ?? "http://127.0.0.1:3000/";
  if (!driver) throw new Error("WEBDRIVER_BIN required");
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const child = spawn(driver, [`--port=${port}`, "--allowed-ips="], { stdio: ["ignore", "pipe", "pipe"] });
  let log = "", session = "";
  child.stdout.on("data", d => log += String(d));
  child.stderr.on("data", d => log += String(d));
  const records = { url, frames: [], errors: [] };
  const command = async (path, method = "GET", data) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, headers: data === undefined ? undefined : { "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const v = await r.json();
    if (!r.ok || v.value?.error) throw new Error(`${method} ${path} failed: ${JSON.stringify(v).slice(0, 600)}`);
    return v.value;
  };
  const js = (script, args = []) => command(`/session/${session}/execute/sync`, "POST", { script, args });
  const wait = async (fn, label, limit = 120) => {
    let last;
    for (let i = 0; i < limit; i++) {
      last = await fn();
      if (last?.ready) return last;
      await sleep(200);
    }
    throw new Error(`${label} timed out: ${JSON.stringify(last).slice(0, 900)}`);
  };
  const click = async (name) => {
    const v = await js(`
      const button=[...document.querySelectorAll('button')].find(x=>x.textContent?.includes(arguments[0]));
      button?.click(); return {ready:!!button,match:button?.textContent};
    `, [name]);
    if (!v.ready) throw new Error(`No button '${name}'`);
  };
  const screenshot = async (file) => {
    // Temporarily hide the bottom transport overlay so the viewer captures
    // BOTH FEET and the ground contact plane. All controls are restored.
    await js("const ui=[...document.querySelectorAll('[aria-label]')].find(x=>x.getAttribute('aria-label')==='Motion Viewer'); if(ui)ui.style.opacity='0'; return !!ui;");
    await sleep(80);
    try {
      const png = Buffer.from(await command(`/session/${session}/screenshot`), "base64");
      if (png.length < 5000 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Screenshot PNG invalid");
      await writeFile(`${out}/${file}.png`, png);
    } finally {
    await js("const ui=[...document.querySelectorAll('[aria-label]')].find(x=>x.getAttribute('aria-label')==='Motion Viewer'); if(ui)ui.style.opacity=''; return !!ui;");
    }
  };
  const clipDefs = [
    { id: "WALK", name: "CMU WALK", phases: [0.08, 0.32, 0.60, 0.87] },
    { id: "BOXING", name: "CMU BOXING", phases: [0.08, 0.26, 0.43, 0.78] },
    { id: "KICK", name: "CMU FRONT KICK", phases: [0.10, 0.22, 0.29, 0.42, 0.78] },
  ];
  await mkdir(out, { recursive: true });
  try {
    await wait(async () => {
      try { return { ready: (await fetch(`http://127.0.0.1:${port}/status`)).ok }; }
      catch { return { ready: false }; }
    }, "ChromeDriver");
    session = (await command("/session", "POST", { capabilities: { alwaysMatch: {
      browserName: "chrome", "goog:chromeOptions": { args: [
        "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
        "--ignore-gpu-blocklist", "--enable-webgl", "--use-angle=swiftshader",
        "--window-size=1536,706", "--hide-scrollbars",
      ] },
    } } })).sessionId;
    await command(`/session/${session}/url`, "POST", { url });
    await sleep(700);
    await click("MODEL VIEW");
    await wait(() => js(`
      const s=document.querySelector('section[aria-label="Model View"]');
      const select=s?.querySelector('select[aria-label="Motion clip"]');
      return {ready:!!select && [...select.options].some(x=>x.value==='BF_FrontKick_R'),opts:select?.options.length,body:s?.textContent.slice(0,180)};
    `), "Motion Viewer readiness", 180);
    for (const fighter of ["SERA", "KAIRO"]) {
      if (fighter === "KAIRO") await click("KAIRO");
      await wait(() => js(`
        const panel=document.querySelector('section[aria-label="Model View"]');
        const sel=panel?.querySelector('select[aria-label="Motion clip"]');
        return {ready:!!panel && !!sel && panel.textContent.includes(arguments[0]) && [...sel.options].some(x=>x.value==='BF_FrontKick_R'),options:sel?.options.length};
      `, [fighter]), `${fighter} ready`, 140);
      for (const clip of clipDefs) {
        const fired = await js(`
          const b=document.querySelector('button[aria-label="Load '+arguments[0]+' reference motion"]');
          b?.click(); return {ready:!!b};
        `, [clip.name]);
        if (!fired.ready) throw new Error(`${clip.name} missing from UI`);
        const loaded = await wait(() => js(`
          const sel=document.querySelector('select[aria-label="Motion clip"]');
          const alerts=[...document.querySelectorAll('[role=alert]')].map(x=>x.textContent);
          return {ready:sel?.value===arguments[0],selected:sel?.value, alerts:alerts.slice(0,3),cmu:[...(sel?.options??[])].filter(x=>x.value.startsWith('CMU_')).map(x=>x.value)};
        `, [`CMU_${clip.id}`]), `Load ${clip.name}`, 200);
        records.frames.push({ fighter, motion: clip.id, loaded });
        for (const camera of ["front", "side"]) {
          if (camera === "side") {
            const p = await js(`
              const r=document.querySelector('section[aria-label="Model View"] canvas')?.getBoundingClientRect();
              return r ? {x:Math.round(r.left+r.width*0.43),y:Math.round(r.top+r.height*0.4)}:null;
            `);
            if (!p) throw new Error("Canvas missing for camera turn");
            await command(`/session/${session}/actions`, "POST", { actions: [{
              type: "pointer", id: "mouse-cmu", parameters: { pointerType: "mouse" },
              actions: [
                { type: "pointerMove", origin: "viewport", x: p.x, y: p.y, duration: 0 },
                { type: "pointerDown", button: 0 },
                { type: "pointerMove", origin: "viewport", x: p.x + 175, y: p.y, duration: 400 },
                { type: "pointerUp", button: 0 },
              ],
            }] });
            await sleep(250);
          }
          for (const phase of clip.phases) {
            const status = await js(`
              document.querySelector('button[aria-label="Pause motion"]')?.click();
              const slider=document.querySelector('input[aria-label="Motion timeline"]');
              if(!slider)return {ready:false};
              Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,String(Math.round(arguments[0]*1000)));
              slider.dispatchEvent(new Event('input',{bubbles:true}));
              slider.dispatchEvent(new Event('change',{bubbles:true}));
              return {ready:true,value:slider.value};
            `, [phase]);
            if (!status.ready) throw new Error("Timeline not accessible");
            await sleep(270);
            const validated = await js(`
              return {
                selected:document.querySelector('select[aria-label="Motion clip"]')?.value,
                normalized:Number(document.querySelector('input[aria-label="Motion timeline"]')?.value)/1000,
                paused:!!document.querySelector('button[aria-label="Play motion"]'),
                auditPose: JSON.parse(document.documentElement.dataset.cmuAuditPose || "null"),
              };
            `);
            if (validated.selected !== `CMU_${clip.id}` || !validated.paused || Math.abs(validated.normalized-phase) > 0.006) {
              throw new Error(`Frame invalid ${fighter}/${clip.id}/${phase}: ${JSON.stringify(validated)}`);
            }
            if (!Array.isArray(validated.auditPose?.calibration) ||
                validated.auditPose.calibration.length !== 4) {
              throw new Error(`${fighter} ${clip.id}: returned to CMU legacy frame-zero/T-pose transfer`);
            }
            const errors = Object.values(validated.auditPose?.trackDeltaDegrees ?? {}).filter(
              (value) => typeof value === "number",
            );
            if (errors.some(value => value > 1)) {
              throw new Error(`${fighter} ${clip.id}: live bones disagree with selected CMU quaternion tracks`);
            }
            if (clip.id === "WALK" && camera === "front" && phase === 0.32) {
              const joints = validated.auditPose.joints;
              for (const side of ["l", "r"]) {
                const upper = joints["upperarm_" + side];
                const lower = joints["lowerarm_" + side];
                if (!upper || !lower) throw new Error(`${fighter}: missing shoulder chain`);
                const dx = lower[0] - upper[0];
                const dy = lower[1] - upper[1];
                const dz = lower[2] - upper[2];
                const downwardRatio = -dy / Math.hypot(dx, dy, dz);
                if (downwardRatio < 0.48) {
                  throw new Error(`${fighter}: ${side} arm in T-pose during CMU WALK (downward ratio ${downwardRatio.toFixed(2)})`);
                }
              }
            }
            const file = `${fighter.toLowerCase()}-cmu-${clip.id.toLowerCase()}-${camera}-${Math.round(phase * 100).toString().padStart(2, "0")}`;
            await screenshot(file);
            records.frames.push({ fighter, motion: clip.id, camera, phase, file: `${file}.png`, state: validated });
          }
        }

        if (clip.id === "BOXING") {
          for (const strike of [
            {name:"CMU_BOXING_RIGHT_STRAIGHT", label:"RIGHT STRAIGHT", key:"right-straight", hits:1},
            {name:"CMU_BOXING_LEFT_RIGHT_COMBO", label:"LEFT → RIGHT COMBO", key:"left-right-combo", hits:2},
          ]) {
            const fired = await js(`
              const b=document.querySelector('button[aria-label="Preview CMU '+arguments[0]+'"]');
              b?.click(); return {clicked:!!b};
            `,[strike.label]);
            if (!fired.clicked) throw new Error("Missing punch preview "+strike.label);
            await wait(()=>js(`
              const sel=document.querySelector('select[aria-label="Motion clip"]');
              return {ready:sel?.value===arguments[0],selected:sel?.value};
            `,[strike.name]),"Select "+strike.name,100);
            const meta=await js(`
              return JSON.parse(document.documentElement.dataset.cmuAuditPose || "null")?.strike ?? null;
            `);
            if(!meta || meta.name!==strike.name || meta.contacts.length!==strike.hits) {
              throw new Error("Bad source timing metadata "+JSON.stringify(meta));
            }
            const targets=[
              {phase:0.04,poseName:"guard",hand:null},
              ...meta.contacts.map((c,i)=>({phase:c.normalized,poseName:"contact-"+(i+1),hand:c.hand})),
              {phase:0.96,poseName:"recovery",hand:null},
            ];
            let rawContactSnapshots = [];
            for (const camera of ["front","side"]) {
              if(camera==="side") {
                const p=await js(`
                  const r=document.querySelector('section[aria-label="Model View"] canvas')?.getBoundingClientRect();
                  return r?{x:Math.round(r.left+r.width*.43),y:Math.round(r.top+r.height*.4)}:null;
                `);
                if(!p)throw new Error("CMU strike canvas missing");
                await command("/session/"+session+"/actions","POST",{actions:[{
                  type:"pointer",id:"mouse-strike",parameters:{pointerType:"mouse"},
                  actions:[
                    {type:"pointerMove",origin:"viewport",x:p.x,y:p.y,duration:0},
                    {type:"pointerDown",button:0},
                    {type:"pointerMove",origin:"viewport",x:p.x+175,y:p.y,duration:400},
                    {type:"pointerUp",button:0},
                  ],
                }]});
                await sleep(200);
              }
              const poses=[];
              for(const targetPose of targets) {
                await js(`
                  document.querySelector('button[aria-label="Pause motion"]')?.click();
                  const slider=document.querySelector('input[aria-label="Motion timeline"]');
                  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")
                    .set.call(slider,String(Math.round(arguments[0]*1000)));
                  slider.dispatchEvent(new Event("input",{bubbles:true}));
                  slider.dispatchEvent(new Event("change",{bubbles:true}));
                  return slider.value;
                `,[targetPose.phase]);
                await sleep(270);
                const state=await js(`
                  return {
                    selected:document.querySelector('select[aria-label="Motion clip"]')?.value,
                    normalized:Number(document.querySelector('input[aria-label="Motion timeline"]')?.value)/1000,
                    paused:!!document.querySelector('button[aria-label="Play motion"]'),
                    pose:JSON.parse(document.documentElement.dataset.cmuAuditPose || "null"),
                  };
                `);
                if(state.selected!==strike.name || !state.paused ||
                   Math.abs(state.normalized-targetPose.phase)>0.008 ||
                   state.pose?.strike?.name!==strike.name) {
                  throw new Error("Incorrect strike screenshot frame "+JSON.stringify(state));
                }
                if(Object.values(state.pose.trackDeltaDegrees ?? {}).some(
                    x=>typeof x==="number" && x>1)) {
                  throw new Error("Strike scene bone disagrees with selected animation");
                }
                const file=fighter.toLowerCase()+"-cmu-"+strike.key+
                  "-"+camera+"-"+targetPose.poseName;
                await screenshot(file);
                poses.push({...state,hand:targetPose.hand,poseName:targetPose.poseName});
                records.frames.push({fighter,motion:strike.name,camera,
                  phase:targetPose.phase,file:file+".png",state});
              }
              if(camera==="front") {
                const reach=(sample,hand)=>{
                  const suffix=hand==="LEFT"?"l":"r";
                  const shoulder=sample.pose.joints["upperarm_"+suffix];
                  const wrist=sample.pose.joints["hand_"+suffix];
                  if(!shoulder||!wrist)throw Error("Missing real shoulder/wrist bone");
                  return Math.hypot(...shoulder.map((v,i)=>wrist[i]-v));
                };
                const guard=poses[0],recovery=poses[poses.length-1];
                for(const hit of poses.filter(p=>p.hand)){
                  const before=reach(guard,hit.hand),during=reach(hit,hit.hand);
                  const after=reach(recovery,hit.hand);
                  if(during<before*1.12||after>during*.96) {
                    throw new Error("Rendered strike lacks guard/extension/recovery "+
                      JSON.stringify({fighter,strike:strike.name,hand:hit.hand,before,during,after}));
                  }
                }
              }
              if (camera === "front") rawContactSnapshots = poses;
              await click("RESET VIEW");
            }
            // A/B: same measured source frames, unchanged body bones,
            // actual closed fingertip geometry in SERA and KAIRO.
            const firedFist = await js(`
              const b=document.querySelector('button[aria-label="Compare CMU boxing fist pose"]');
              b?.click();
              return {clicked:!!b};
            `);
            if(!firedFist.clicked)throw Error("FIST comparison control missing for "+strike.name);
            await wait(()=>js(`
              const value=document.querySelector('select[aria-label="Motion clip"]')?.value;
              return {ready:value===arguments[0],value};
            `,[strike.name+"_FIST"]),"Load "+strike.name+"_FIST",100);
            for (const camera of ["front","side"]) {
              if(camera==="side") {
                const p=await js(`
                  const r=document.querySelector('section[aria-label="Model View"] canvas')?.getBoundingClientRect();
                  return r?{x:Math.round(r.left+r.width*.43),y:Math.round(r.top+r.height*.4)}:null;
                `);
                if(!p)throw Error("Missing fighter canvas for FIST review");
                await command("/session/"+session+"/actions","POST",{actions:[{
                  type:"pointer",id:"mouse-fist",parameters:{pointerType:"mouse"},
                  actions:[
                    {type:"pointerMove",origin:"viewport",x:p.x,y:p.y,duration:0},
                    {type:"pointerDown",button:0},
                    {type:"pointerMove",origin:"viewport",x:p.x+175,y:p.y,duration:400},
                    {type:"pointerUp",button:0},
                  ],
                }]});
                await sleep(200);
              }
              for(const targetPose of targets) {
                await js(`
                  document.querySelector('button[aria-label="Pause motion"]')?.click();
                  const slider=document.querySelector('input[aria-label="Motion timeline"]');
                  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")
                    .set.call(slider,String(Math.round(arguments[0]*1000)));
                  slider.dispatchEvent(new Event("input",{bubbles:true}));
                  slider.dispatchEvent(new Event("change",{bubbles:true}));
                  return slider.value;
                `,[targetPose.phase]);
                await sleep(270);
                const state=await js(`
                  return {
                    selected:document.querySelector('select[aria-label="Motion clip"]')?.value,
                    normalized:Number(document.querySelector('input[aria-label="Motion timeline"]')?.value)/1000,
                    paused:!!document.querySelector('button[aria-label="Play motion"]'),
                    pose:JSON.parse(document.documentElement.dataset.cmuAuditPose || "null"),
                  };
                `);
                if (state.selected!==strike.name+"_FIST"||!state.paused||
                    Math.abs(state.normalized-targetPose.phase)>0.008||
                    state.pose?.strike?.name!==strike.name+"_FIST") {
                  throw Error("Bad rendered FIST state "+JSON.stringify(state));
                }
                if(Object.values(state.pose.trackDeltaDegrees??{}).some(
                    x=>typeof x==="number" && x>1)){
                  throw Error("Real finger or body bone not following FIST tracks");
                }
                if(camera==="front") {
                  const original=rawContactSnapshots.find(x=>x.poseName===targetPose.poseName);
                  if(!original)throw Error("Original CMU boxing frame missing");
                  const measure=(pose,side,digit)=>{
                    const a=pose.joints[digit+"_01_"+side];
                    const b=pose.joints[digit+"_04_leaf_"+side];
                    if(!a||!b)throw Error("Missing actual played finger pose");
                    return Math.hypot(...a.map((v,i)=>b[i]-v));
                  };
                  for(const side of ["l","r"]) {
                    for(const digit of ["index","middle","ring","pinky"]) {
                      const open=measure(original.pose,side,digit);
                      const curled=measure(state.pose,side,digit);
                      if (curled>=open*.84)throw Error("Live FIST finger failed to bend "+JSON.stringify({
                        fighter,strike:strike.name,side,digit,open,curled,
                      }));
                    }
                    for(const bone of ["upperarm_"+side,"lowerarm_"+side,"hand_"+side]) {
                      const before=original.pose.joints[bone];
                      const after=state.pose.joints[bone];
                      if(!before||!after||Math.hypot(...before.map((v,i)=>after[i]-v))>.015) {
                        throw Error("FIST altered original fighter attack body motion "+bone);
                      }
                    }
                  }
                }
                const file=fighter.toLowerCase()+"-cmu-"+strike.key+
                  "-fist-"+camera+"-"+targetPose.poseName;
                await screenshot(file);
                records.frames.push({fighter,motion:strike.name+"_FIST",
                  camera,phase:targetPose.phase,file:file+".png",state});
              }
              await click("RESET VIEW");
            }
          }
        }
        if (clip.id === "WALK" || clip.id === "KICK") {
          const toggle = await js(`
            const b=document.querySelector('button[aria-label="Compare CMU stance foot IK"]');
            b?.click(); return {ready:!!b};
          `);
          if (!toggle.ready) throw new Error("CMU " + clip.id + " stance IK toggle missing");
          await wait(() => js(`
            const selected=document.querySelector('select[aria-label="Motion clip"]')?.value;
            return {ready:selected===arguments[0],selected};
          `, ["CMU_" + clip.id + "_STANCE"]), "Stance IK switch " + clip.id, 90);
          await click("RESET VIEW");
          for (const phase of clip.id === "WALK" ? [0.32, 0.60] : [0.29, 0.42]) {
            await js(`
              document.querySelector('button[aria-label="Pause motion"]')?.click();
              const slider=document.querySelector('input[aria-label="Motion timeline"]');
              Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,String(Math.round(arguments[0]*1000)));
              slider.dispatchEvent(new Event('input',{bubbles:true}));
              slider.dispatchEvent(new Event('change',{bubbles:true}));
              return slider.value;
            `, [phase]);
            await sleep(270);
            const selection = await js(`
              return {
                selected:document.querySelector('select[aria-label="Motion clip"]')?.value,
                normalized:Number(document.querySelector('input[aria-label="Motion timeline"]')?.value)/1000,
                paused:!!document.querySelector('button[aria-label="Play motion"]'),
                pose:JSON.parse(document.documentElement.dataset.cmuAuditPose || "null"),
              };
            `);
            if (selection.selected !== "CMU_" + clip.id + "_STANCE" ||
                !selection.paused || Math.abs(selection.normalized - phase) > .006) {
              throw new Error("Wrong stance IK pose " + JSON.stringify(selection));
            }
            const key = fighter.toLowerCase() + "-cmu-" + clip.id.toLowerCase() +
              "-stance-front-" + Math.round(phase*100);
            await screenshot(key);
            records.frames.push({fighter,motion:clip.id+"_STANCE",camera:"front",phase,
              file:key+".png",state:selection});
          }
        }
        await click("RESET VIEW");
      }
    }
  } catch (e) {
    records.errors.push(e instanceof Error ? e.stack : String(e));
    throw e;
  } finally {
    await writeFile(`${out}/report.json`, JSON.stringify(records, null, 2));
    await writeFile(`${out}/webdriver.log`, log);
    if (session) await command(`/session/${session}`, "DELETE").catch(() => {});
    child.kill("SIGTERM");
    console.log(JSON.stringify({ frameCount: records.frames.length, errors: records.errors }));
  }
})().catch(error=>{console.error(error);process.exitCode=1});