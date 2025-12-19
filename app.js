/* global SUPABASE_URL, SUPABASE_ANON_KEY, DEFAULT_OPENING_BALANCE, CF_MONTHS */
(function(){
  const supabaseCdn = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
  function injectSupabase(){
    return new Promise((resolve, reject) => {
      if (window.supabase) return resolve();
      const s = document.createElement("script");
      s.src = supabaseCdn;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load supabase-js from CDN"));
      document.head.appendChild(s);
    });
  }

  function fmtJPY(n){
    if (n === null || n === undefined || isNaN(n)) return "-";
    const v = Math.round(Number(n));
    return v.toLocaleString("ja-JP");
  }

  function ym(dateStr){
    const d = new Date(dateStr + "T00:00:00");
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    return `${y}-${m}`;
  }

  function addMonths(ymStr, delta){
    const [y,m] = ymStr.split("-").map(Number);
    const d = new Date(y, m-1 + delta, 1);
    const yy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,"0");
    return `${yy}-${mm}`;
  }

  function monthRangeStartEnd(ymStr){
    const [y,m] = ymStr.split("-").map(Number);
    const start = new Date(y, m-1, 1);
    const end = new Date(y, m, 1);
    const toISO = (d)=> d.toISOString().slice(0,10);
    return { start: toISO(start), end: toISO(end) };
  }

  function qs(name){
    const u = new URL(location.href);
    return u.searchParams.get(name);
  }

  function setToast(el, msg, ok=true){
    if (!el) return;
    el.textContent = msg || "";
    el.className = "toast " + (ok ? "ok" : "err");
  }

  function requireConfig(){
    if (!SUPABASE_URL || SUPABASE_URL.includes("YOUR_PROJECT")) {
      throw new Error("config.js の SUPABASE_URL が未設定です");
    }
    if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")) {
      throw new Error("config.js の SUPABASE_ANON_KEY が未設定です");
    }
  }

  async function getClient(){
    requireConfig();
    await injectSupabase();
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  async function getSession(client){
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  async function ensureAuthed(client){
    const session = await getSession(client);
    if (!session) {
      // allow index page to show login UI
      const allow = document.body?.dataset?.allowAnon === "1";
      if (!allow) location.href = "index.html";
    }
    return session;
  }

  async function signInWithOtp(client, email){
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + location.pathname.replace(/\/[^/]*$/, "/") + "index.html" }
    });
    if (error) throw error;
  }

  async function signOut(client){
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }

  async function upsertSettingOpeningBalance(client, openingBalance){
    // table settings: 1 row per user
    const session = await ensureAuthed(client);
    const user_id = session.user.id;
    const { error } = await client
      .from("settings")
      .upsert({ user_id, opening_balance: Number(openingBalance) }, { onConflict: "user_id" });
    if (error) throw error;
  }

  async function getOpeningBalance(client){
    const session = await ensureAuthed(client);
    const user_id = session.user.id;
    const { data, error } = await client
      .from("settings")
      .select("opening_balance")
      .eq("user_id", user_id)
      .maybeSingle();
    if (error) throw error;
    const v = data?.opening_balance;
    if (v === null || v === undefined) return (window.DEFAULT_OPENING_BALANCE ?? 0);
    return Number(v);
  }

  async function insertCashItem(client, item){
    const session = await ensureAuthed(client);
    const payload = { ...item, user_id: session.user.id };
    const { error } = await client.from("cash_items").insert(payload);
    if (error) throw error;
  }

  async function updateCashItem(client, id, patch){
    const session = await ensureAuthed(client);
    const { error } = await client
      .from("cash_items")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", session.user.id);
    if (error) throw error;
  }

  async function deleteCashItem(client, id){
    const session = await ensureAuthed(client);
    const { error } = await client
      .from("cash_items")
      .delete()
      .eq("id", id)
      .eq("user_id", session.user.id);
    if (error) throw error;
  }

  async function getCashItem(client, id){
    const session = await ensureAuthed(client);
    const { data, error } = await client
      .from("cash_items")
      .select("*")
      .eq("id", id)
      .eq("user_id", session.user.id)
      .single();
    if (error) throw error;
    return data;
  }

  async function listCashItemsByMonth(client, ymStr){
    const session = await ensureAuthed(client);
    const { start, end } = monthRangeStartEnd(ymStr);
    const { data, error } = await client
      .from("cash_items")
      .select("*")
      .eq("user_id", session.user.id)
      .gte("due_date", start)
      .lt("due_date", end)
      .order("due_date", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function listCashItemsRange(client, startDate, endDate){
    const session = await ensureAuthed(client);
    const { data, error } = await client
      .from("cash_items")
      .select("*")
      .eq("user_id", session.user.id)
      .gte("due_date", startDate)
      .lt("due_date", endDate)
      .order("due_date", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  function renderHeader({ title }){
    const header = document.querySelector("header");
    if (!header) return;
    const t = header.querySelector("[data-title]");
    if (t) t.textContent = title || "";
  }

  function pill(status, flow){
    const s = status === "confirmed" ? "confirmed" : "forecast";
    const st = status === "confirmed" ? "確定" : "見込み";
    const fl = flow === "in" ? "入金" : "出金";
    return `
      <span class="pill ${s}">${st}</span>
      <span class="pill ${flow}">${fl}</span>
    `;
  }

  // ---------- Page controllers ----------
  async function pageIndex(){
    document.body.dataset.allowAnon = "1";
    const toast = document.querySelector("#toast");
    try{
      const client = await getClient();
      const session = await getSession(client);

      const userBox = document.querySelector("#userBox");
      const authBox = document.querySelector("#authBox");
      const emailEl = document.querySelector("#email");
      const btnLogin = document.querySelector("#btnLogin");
      const btnLogout = document.querySelector("#btnLogout");
      const obEl = document.querySelector("#openingBalance");
      const btnSaveOb = document.querySelector("#btnSaveOb");

      if (session){
        authBox.style.display = "none";
        userBox.style.display = "block";
        userBox.querySelector("#userEmail").textContent = session.user.email || session.user.id;

        // opening balance
        const ob = await getOpeningBalance(client);
        obEl.value = String(ob ?? 0);

        btnLogout.onclick = async ()=>{
          await signOut(client);
          location.reload();
        };

        btnSaveOb.onclick = async ()=>{
          const v = Number(obEl.value || 0);
          await upsertSettingOpeningBalance(client, v);
          setToast(toast, "初期残高を保存しました", true);
        };
      }else{
        authBox.style.display = "block";
        userBox.style.display = "none";
        btnLogin.onclick = async ()=>{
          const email = (emailEl.value || "").trim();
          if (!email) return setToast(toast, "メールアドレスを入力してください", false);
          await signInWithOtp(client, email);
          setToast(toast, "ログインリンクを送信しました（メールをご確認ください）", true);
        };
      }
    }catch(e){
      setToast(document.querySelector("#toast"), e.message || String(e), false);
    }
  }

  async function pageEntry(){
    const toast = document.querySelector("#toast");
    try{
      const client = await getClient();
      await ensureAuthed(client);

      // default dates
      const today = new Date().toISOString().slice(0,10);
      document.querySelector("#entry_date").value = today;
      document.querySelector("#due_date").value = today;

      document.querySelector("#form").addEventListener("submit", async (ev)=>{
        ev.preventDefault();
        const item = {
          entry_date: document.querySelector("#entry_date").value,
          partner: document.querySelector("#partner").value.trim() || null,
          closing_day: document.querySelector("#closing_day").value ? Number(document.querySelector("#closing_day").value) : null,
          due_date: document.querySelector("#due_date").value,
          flow: document.querySelector("#flow").value,
          item_name: document.querySelector("#item_name").value.trim(),
          status: document.querySelector("#status").value,
          note: document.querySelector("#note").value.trim() || null,
          memo: document.querySelector("#memo").value.trim() || null,
          amount: Number(document.querySelector("#amount").value || 0),
        };
        if (!item.item_name) return setToast(toast, "項目名は必須です", false);
        if (!item.due_date) return setToast(toast, "支払日/入金日は必須です", false);
        if (!Number.isFinite(item.amount)) return setToast(toast, "金額を正しく入力してください", false);

        await insertCashItem(client, item);
        setToast(toast, "登録しました", true);
        (document.querySelector("#form")).reset();
        document.querySelector("#entry_date").value = today;
        document.querySelector("#due_date").value = today;
        document.querySelector("#flow").value = "out";
        document.querySelector("#status").value = "forecast";
      });

    }catch(e){
      setToast(toast, e.message || String(e), false);
    }
  }

  async function pageCF(){
    const toast = document.querySelector("#toast");
    try{
      const client = await getClient();
      await ensureAuthed(client);

      const opening = await getOpeningBalance(client);
      const now = new Date();
      const thisYm = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
      const months = Number(window.CF_MONTHS ?? 12);

      const startYm = thisYm;
      const endYm = addMonths(thisYm, months); // exclusive
      const start = monthRangeStartEnd(startYm).start;
      const end = monthRangeStartEnd(endYm).start;

      const rows = await listCashItemsRange(client, start, end);

      // group by month
      const by = new Map();
      for (let i=0;i<months;i++){
        const m = addMonths(thisYm, i);
        by.set(m, { ym: m, in: 0, out: 0, net: 0, end: 0 });
      }
      for (const r of rows){
        const m = ym(r.due_date);
        if (!by.has(m)) continue;
        const amt = Number(r.amount || 0);
        if (r.flow === "in") by.get(m).in += amt;
        else by.get(m).out += amt;
      }

      let bal = Number(opening || 0);
      for (let i=0;i<months;i++){
        const m = addMonths(thisYm, i);
        const o = by.get(m);
        o.net = o.in - o.out;
        bal = bal + o.net;
        o.end = bal;
      }

      const tbody = document.querySelector("#cfBody");
      tbody.innerHTML = "";
      for (let i=0;i<months;i++){
        const m = addMonths(thisYm, i);
        const o = by.get(m);
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><a href="list.html?month=${m}">${m}</a></td>
          <td class="right">${fmtJPY(o.in)}</td>
          <td class="right">${fmtJPY(o.out)}</td>
          <td class="right">${fmtJPY(o.net)}</td>
          <td class="right">${fmtJPY(o.end)}</td>
        `;
        tbody.appendChild(tr);
      }
      document.querySelector("#openingBalanceView").textContent = fmtJPY(opening);
      setToast(toast, "更新しました", true);

    }catch(e){
      setToast(toast, e.message || String(e), false);
    }
  }

  async function pageList(){
    const toast = document.querySelector("#toast");
    try{
      const client = await getClient();
      await ensureAuthed(client);

      const now = new Date();
      const defaultYm = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
      const month = qs("month") || defaultYm;

      const monthSel = document.querySelector("#month");
      monthSel.value = month;
      monthSel.onchange = ()=> location.href = `list.html?month=${monthSel.value}`;

      const rows = await listCashItemsByMonth(client, month);

      // totals
      let tin=0, tout=0;
      for (const r of rows){
        const amt = Number(r.amount||0);
        if (r.flow==="in") tin += amt;
        else tout += amt;
      }
      document.querySelector("#sumIn").textContent = fmtJPY(tin);
      document.querySelector("#sumOut").textContent = fmtJPY(tout);
      document.querySelector("#sumNet").textContent = fmtJPY(tin - tout);

      const tbody = document.querySelector("#listBody");
      tbody.innerHTML = "";
      for (const r of rows){
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td class="small">${r.due_date}</td>
          <td>${pill(r.status, r.flow)}<div class="small">${escapeHtml(r.partner||"")}</div></td>
          <td>${escapeHtml(r.item_name||"")}</td>
          <td class="right">${fmtJPY(r.amount)}</td>
          <td class="small">${escapeHtml(r.note||"")}</td>
          <td class="right">
            <a class="btn primary" href="edit.html?id=${r.id}">編集</a>
          </td>
        `;
        tbody.appendChild(tr);
      }

      setToast(toast, `表示：${month}`, true);

      // Quick toggle buttons
      document.querySelector("#btnOnlyConfirmed").onclick = ()=>{
        const trs = [...tbody.querySelectorAll("tr")];
        trs.forEach(tr=>{
          const pills = tr.querySelectorAll(".pill.confirmed");
          tr.style.display = pills.length ? "" : "none";
        });
      };
      document.querySelector("#btnShowAll").onclick = ()=>{
        [...tbody.querySelectorAll("tr")].forEach(tr=> tr.style.display = "");
      };

    }catch(e){
      setToast(toast, e.message || String(e), false);
    }
  }

  async function pageEdit(){
    const toast = document.querySelector("#toast");
    try{
      const client = await getClient();
      await ensureAuthed(client);

      const id = qs("id");
      if (!id) throw new Error("id が指定されていません");

      const item = await getCashItem(client, id);

      // fill
      for (const k of ["entry_date","partner","closing_day","due_date","flow","item_name","status","note","memo","amount"]){
        const el = document.querySelector("#"+k);
        if (!el) continue;
        el.value = item[k] ?? "";
      }

      document.querySelector("#btnToggle").onclick = async ()=>{
        const next = (document.querySelector("#status").value === "confirmed") ? "forecast" : "confirmed";
        document.querySelector("#status").value = next;
        setToast(toast, `ステータスを ${next === "confirmed" ? "確定" : "見込み"} に変更しました（未保存）`, true);
      };

      document.querySelector("#form").addEventListener("submit", async (ev)=>{
        ev.preventDefault();
        const patch = {
          entry_date: document.querySelector("#entry_date").value,
          partner: document.querySelector("#partner").value.trim() || null,
          closing_day: document.querySelector("#closing_day").value ? Number(document.querySelector("#closing_day").value) : null,
          due_date: document.querySelector("#due_date").value,
          flow: document.querySelector("#flow").value,
          item_name: document.querySelector("#item_name").value.trim(),
          status: document.querySelector("#status").value,
          note: document.querySelector("#note").value.trim() || null,
          memo: document.querySelector("#memo").value.trim() || null,
          amount: Number(document.querySelector("#amount").value || 0),
        };
        if (!patch.item_name) return setToast(toast, "項目名は必須です", false);
        if (!patch.due_date) return setToast(toast, "支払日/入金日は必須です", false);
        if (!Number.isFinite(patch.amount)) return setToast(toast, "金額を正しく入力してください", false);

        await updateCashItem(client, id, patch);
        setToast(toast, "保存しました", true);
      });

      document.querySelector("#btnDelete").onclick = async ()=>{
        if (!confirm("この行を削除しますか？")) return;
        await deleteCashItem(client, id);
        location.href = "list.html?month=" + ym(item.due_date);
      };

      document.querySelector("#backToMonth").href = "list.html?month=" + ym(item.due_date);

    }catch(e){
      setToast(toast, e.message || String(e), false);
    }
  }

  function escapeHtml(s){
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  // Router
  window.CFApp = {
    fmtJPY, ym, addMonths, monthRangeStartEnd,
    getClient, ensureAuthed, signOut, signInWithOtp,
    pageIndex, pageEntry, pageCF, pageList, pageEdit,
    setToast
  };
})();
