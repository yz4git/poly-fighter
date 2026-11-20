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
    await js("const ui=document.querySelector('[aria-label=\\"Motion Viewer\\"]'); if(ui)ui.style.opacity='0'; return !!ui;");
    await sleep(80);
    try {
      const png = Buffer.from(await command(`/session/${session}/screenshot`), "base64");
      if (png.length < 5000 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Screenshot PNG invalid");
      await writeFile(`${out}/${file}.png`, png);
    } finally {
      await js("const ui=document.querySelector('[aria-label=\\"Motion Viewer\\"]'); if(ui)ui.style.opacity=''; return !!ui;");
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
              };
            `);
            if (validated.selected !== `CMU_${clip.id}` || !validated.paused || Math.abs(validated.normalized-phase) > 0.006) {
              throw new Error(`Frame invalid ${fighter}/${clip.id}/${phase}: ${JSON.stringify(validated)}`);
            }
            const file = `${fighter.toLowerCase()}-cmu-${clip.id.toLowerCase()}-${camera}-${Math.round(phase * 100).toString().padStart(2, "0")}`;
            await screenshot(file);
            records.frames.push({ fighter, motion: clip.id, camera, phase, file: `${file}.png`, state: validated });
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