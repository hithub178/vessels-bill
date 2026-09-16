const STORAGE = {
  shop: "vessel-pos.shop",
  vessels: "vessel-pos.vessels",
  bills: "vessel-pos.bills",
  draft: "vessel-pos.draft",
};

const BUSINESS = "AR VESSELS";

const money = (n) =>
  "₹" +
  Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();

const round2 = (n) => Math.round(Number(n) * 100) / 100;

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function initials(name) {
  return (name || "AR")
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
}

function soldByOf(item) {
  return item?.soldBy === "unit" ? "unit" : "weight";
}

function qtyOf(item) {
  return Number(item.qty ?? item.kg ?? item.defaultQty ?? item.defaultKg ?? 1);
}

function rateOf(item) {
  return Number(item.rate ?? item.pricePerKg ?? 0);
}

function qtyLabel(soldBy) {
  return soldBy === "unit" ? "Units" : "Weight (KG)";
}

function rateLabel(soldBy) {
  return soldBy === "unit" ? "₹ / Unit" : "₹ / KG";
}

function normalizeVessel(v) {
  return {
    id: v.id,
    name: v.name,
    image: v.image || "",
    soldBy: soldByOf(v),
    defaultQty: qtyOf(v),
    rate: rateOf(v),
  };
}

function normalizeLine(line) {
  return {
    id: line.id,
    vesselId: line.vesselId,
    name: line.name,
    soldBy: soldByOf(line),
    qty: qtyOf(line),
    rate: rateOf(line),
  };
}

function loadShop() {
  const shop = load(STORAGE.shop, { name: BUSINESS });
  if (!shop.name || shop.name === "Harbour Stall" || shop.name === "Vessel POS") {
    shop.name = BUSINESS;
  }
  return shop;
}

const state = {
  shop: loadShop(),
  vessels: load(STORAGE.vessels, []).map(normalizeVessel),
  bills: load(STORAGE.bills, []).map((b) => ({
    ...b,
    lines: (b.lines || []).map(normalizeLine),
  })),
  draft: (() => {
    const d = load(STORAGE.draft, { customer: "", lines: [], billId: null });
    return {
      customer: d.customer || "",
      lines: (d.lines || []).map(normalizeLine),
      billId: d.billId || null,
    };
  })(),
  view: "billing",
  editingId: null,
  pendingVesselId: null,
  imageData: "",
  search: "",
  month: new Date().toISOString().slice(0, 7),
};

function persist() {
  save(STORAGE.shop, state.shop);
  save(STORAGE.vessels, state.vessels);
  save(STORAGE.bills, state.bills);
  save(STORAGE.draft, state.draft);
}

function lineAmount(line) {
  const n = normalizeLine(line);
  return round2(n.qty * n.rate);
}

function draftTotal() {
  return round2(state.draft.lines.reduce((sum, line) => sum + lineAmount(line), 0));
}

function nextBillNo(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const prefix = `ARV-${y}${m}-`;
  const seq = state.bills
    .filter((b) => String(b.number).startsWith(prefix) || String(b.number).startsWith("VSL-"))
    .reduce((max, b) => {
      const n = Number(String(b.number).slice(-4));
      return n > max ? n : max;
    }, 0);
  return prefix + String(seq + 1).padStart(4, "0");
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 640;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      img.onerror = () => reject(new Error("Invalid image"));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function photoHtml(image, name, className = "") {
  if (image) return `<img class="${className}" src="${image}" alt="" />`;
  return `<div class="placeholder-art ${className}">${initials(name)}</div>`;
}

function filteredVessels() {
  const q = state.search.trim().toLowerCase();
  if (!q) return state.vessels;
  return state.vessels.filter((v) => v.name.toLowerCase().includes(q));
}

function selectedSoldBy() {
  return document.querySelector('input[name="sold-by"]:checked')?.value || "weight";
}

function syncSoldByLabels(soldBy) {
  document.getElementById("qty-label").textContent =
    soldBy === "unit" ? "Default units" : "Default weight (KG)";
  document.getElementById("rate-label").textContent = rateLabel(soldBy);
}

function renderClock() {
  const now = new Date();
  document.getElementById("clock").textContent = now.toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderGrid() {
  const grid = document.getElementById("vessel-grid");
  const vessels = filteredVessels();
  if (!vessels.length) {
    grid.innerHTML = `<p class="empty-grid">${
      state.vessels.length
        ? "No vessels match that search."
        : "No vessels yet. Add one to start billing."
    }</p>`;
    return;
  }
  grid.innerHTML = vessels
    .map((v) => {
      const by = soldByOf(v);
      return `
      <article class="vessel-card">
        <button type="button" class="card-hit" data-add="${v.id}" title="Add to bill">
          ${photoHtml(v.image, v.name)}
        </button>
        <div class="card-body">
          <h3>
            <button type="button" class="name-hit" data-add="${v.id}">${escapeHtml(v.name)}</button>
            <span class="badge ${by}">${by === "unit" ? "Unit" : "KG"}</span>
          </h3>
          <p class="price-row">
            ${rateLabel(by)}
            <input type="number" min="0" step="0.01" value="${rateOf(v)}" data-price="${v.id}" />
          </p>
          <div class="card-actions">
            <button class="btn tiny" type="button" data-edit="${v.id}">Edit</button>
            <button class="btn tiny danger" type="button" data-delete="${v.id}">Delete</button>
          </div>
        </div>
      </article>`;
    })
    .join("");
}

function renderMenu() {
  const body = document.getElementById("menu-body");
  if (!state.vessels.length) {
    body.innerHTML = `<tr><td colspan="5" class="empty-grid">Menu is empty. Add a vessel.</td></tr>`;
    return;
  }
  body.innerHTML = state.vessels
    .map((v) => {
      const by = soldByOf(v);
      return `
      <tr>
        <td>
          <div class="vessel-cell">
            ${photoHtml(v.image, v.name, "thumb")}
            <div>
              <strong>${escapeHtml(v.name)}</strong>
              <span class="badge ${by}">${by === "unit" ? "Unit" : "KG"}</span>
            </div>
          </div>
        </td>
        <td>
          <select data-menu-sold="${v.id}">
            <option value="weight" ${by === "weight" ? "selected" : ""}>Weight (KG)</option>
            <option value="unit" ${by === "unit" ? "selected" : ""}>Unit</option>
          </select>
        </td>
        <td>
          <input type="number" min="0.01" step="0.01" value="${qtyOf(v)}" data-menu-qty="${v.id}" />
        </td>
        <td>
          <input type="number" min="0" step="0.01" value="${rateOf(v)}" data-price="${v.id}" />
        </td>
        <td class="row-actions">
          <button class="btn tiny" type="button" data-edit="${v.id}">Edit</button>
          <button class="btn tiny danger" type="button" data-delete="${v.id}">Delete</button>
        </td>
      </tr>`;
    })
    .join("");
}

function renderBill() {
  const editing = state.bills.find((b) => b.id === state.draft.billId);
  document.getElementById("draft-no").textContent = editing ? editing.number : "Draft";
  document.getElementById("customer").value = state.draft.customer;
  document.getElementById("btn-save").textContent = editing ? "Update bill" : "Save bill";
  const list = document.getElementById("bill-lines");
  if (!state.draft.lines.length) {
    list.innerHTML = `<li class="empty-lines">Click a vessel, then enter KG or units.</li>`;
  } else {
    list.innerHTML = state.draft.lines
      .map((raw) => {
        const line = normalizeLine(raw);
        const by = line.soldBy;
        return `
        <li class="line">
          <span class="name">${escapeHtml(line.name)}<span class="meta">${qtyLabel(by)}</span></span>
          <input type="number" min="0.01" step="0.01" value="${line.qty}" data-line-qty="${line.id}" aria-label="${qtyLabel(by)}" />
          <input type="number" min="0" step="0.01" value="${line.rate}" data-line-rate="${line.id}" aria-label="${rateLabel(by)}" />
          <span class="amt">${money(lineAmount(line))}</span>
          <button class="btn tiny ghost" type="button" data-remove="${line.id}" aria-label="Remove">✕</button>
        </li>`;
      })
      .join("");
  }
  document.getElementById("item-count").textContent = String(state.draft.lines.length);
  document.getElementById("grand-total").textContent = money(draftTotal());
}

function billsInMonth(month) {
  return state.bills.filter((b) => String(b.createdAt).slice(0, 7) === month);
}

function renderHistory() {
  const monthInput = document.getElementById("month-filter");
  monthInput.value = state.month;
  const bills = billsInMonth(state.month).slice().reverse();
  const total = bills.reduce((sum, b) => sum + Number(b.grandTotal || 0), 0);
  document.getElementById("history-stats").innerHTML = `
    <div class="stat"><span>Bills this month</span><strong>${bills.length}</strong></div>
    <div class="stat"><span>Collected</span><strong>${money(total)}</strong></div>
  `;
  const list = document.getElementById("history-list");
  if (!bills.length) {
    list.innerHTML = `<li class="empty-history">No saved bills in this month.</li>`;
    if (!state.previewBillId || !billsInMonth(state.month).some((b) => b.id === state.previewBillId)) {
      document.getElementById("bill-preview-wrap").hidden = true;
    }
    return;
  }
  list.innerHTML = bills
    .map(
      (b) => `
      <li class="history-item ${state.previewBillId === b.id ? "is-open" : ""}">
        <button type="button" class="history-open" data-view-bill="${b.id}">
          <span>
            <strong>${escapeHtml(b.number)}</strong>
            <p>${new Date(b.createdAt).toLocaleString("en-IN")} · ${escapeHtml(
              b.customer || "Walk-in"
            )} · ${b.lines.length} item(s)</p>
          </span>
          <strong>${money(b.grandTotal)}</strong>
        </button>
        <div class="history-actions">
          <button class="btn tiny" type="button" data-view-bill="${b.id}">View</button>
          <button class="btn tiny" type="button" data-edit-bill="${b.id}">Edit</button>
          <button class="btn" type="button" data-print-bill="${b.id}">Print bill</button>
          <button class="btn tiny danger" type="button" data-delete-bill="${b.id}">Delete</button>
        </div>
      </li>`
    )
    .join("");
  if (state.previewBillId) showHistoryBill(state.previewBillId);
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === view);
  });
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.viewPanel === view);
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function openQtyPrompt(id) {
  const vessel = state.vessels.find((v) => v.id === id);
  if (!vessel) return;
  state.pendingVesselId = id;
  const by = soldByOf(vessel);
  document.getElementById("qty-modal-title").textContent =
    by === "unit" ? `Units for ${vessel.name}` : `Weight for ${vessel.name}`;
  document.getElementById("qty-modal-hint").textContent =
    by === "unit"
      ? `Rate ${money(rateOf(vessel))} per unit. You can change qty later on the bill.`
      : `Rate ${money(rateOf(vessel))} per KG. You can change weight later on the bill.`;
  document.getElementById("qty-input-label").textContent = qtyLabel(by);
  const input = document.getElementById("qty-input");
  input.step = by === "unit" ? "1" : "0.01";
  input.min = by === "unit" ? "1" : "0.01";
  input.value = qtyOf(vessel);
  document.getElementById("qty-modal-root").hidden = false;
  input.focus();
  input.select();
}

function closeQtyPrompt() {
  document.getElementById("qty-modal-root").hidden = true;
  state.pendingVesselId = null;
}

function commitQtyToBill(qty) {
  const vessel = state.vessels.find((v) => v.id === state.pendingVesselId);
  if (!vessel || !(qty > 0)) return;
  const by = soldByOf(vessel);
  const existing = state.draft.lines.find((l) => l.vesselId === vessel.id);
  if (existing) {
    existing.qty = round2(qtyOf(existing) + qty);
    existing.soldBy = by;
    existing.rate = rateOf(existing) || rateOf(vessel);
    existing.name = vessel.name;
  } else {
    state.draft.lines.push({
      id: uid(),
      vesselId: vessel.id,
      name: vessel.name,
      soldBy: by,
      qty: round2(qty),
      rate: rateOf(vessel),
    });
  }
  persist();
  closeQtyPrompt();
  renderBill();
}

function updateVesselPrice(id, price) {
  const vessel = state.vessels.find((v) => v.id === id);
  if (!vessel) return;
  vessel.rate = round2(price);
  persist();
  renderGrid();
  renderMenu();
}

function deleteVessel(id) {
  const vessel = state.vessels.find((v) => v.id === id);
  if (!vessel) return;
  if (!confirm(`Delete “${vessel.name}” from the menu?`)) return;
  state.vessels = state.vessels.filter((v) => v.id !== id);
  persist();
  renderGrid();
  renderMenu();
}

function openVesselModal(id) {
  state.editingId = id || null;
  const modal = document.getElementById("modal-root");
  const title = document.getElementById("vessel-modal-title");
  const vessel = state.vessels.find((v) => v.id === id);
  title.textContent = vessel ? "Edit vessel" : "Add Vessel";
  document.getElementById("vessel-name").value = vessel?.name || "";
  const by = vessel ? soldByOf(vessel) : "weight";
  document.querySelectorAll('input[name="sold-by"]').forEach((el) => {
    el.checked = el.value === by;
  });
  syncSoldByLabels(by);
  document.getElementById("vessel-qty").value = vessel ? qtyOf(vessel) : 1;
  document.getElementById("vessel-price").value = vessel ? rateOf(vessel) : "";
  state.imageData = vessel?.image || "";
  paintPhoto();
  modal.hidden = false;
  document.getElementById("vessel-name").focus();
}

function closeVesselModal() {
  document.getElementById("modal-root").hidden = true;
  document.getElementById("vessel-form").reset();
  state.editingId = null;
  state.imageData = "";
  paintPhoto();
  syncSoldByLabels("weight");
}

function paintPhoto() {
  const frame = document.getElementById("photo-frame");
  if (state.imageData) {
    frame.innerHTML = `<img src="${state.imageData}" alt="Vessel preview" />`;
  } else {
    frame.innerHTML = "<span>Upload image</span>";
  }
}

function qtyText(line) {
  const n = normalizeLine(line);
  if (n.soldBy === "unit") return `${Number(n.qty)} u`;
  return `${Number(n.qty).toFixed(2)} kg`;
}

function receiptInner(bill) {
  const shop = escapeHtml(state.shop.name || BUSINESS);
  const rows = bill.lines
    .map((raw) => {
      const line = normalizeLine(raw);
      return `
        <div class="rc-item">
          <p class="rc-name">${escapeHtml(line.name)}</p>
          <p class="rc-row">
            <span>${qtyText(line)} x ${money(line.rate)}</span>
            <span>${money(lineAmount(line))}</span>
          </p>
        </div>`;
    })
    .join("");
  return `
    <h1>${shop}</h1>
    <p class="rc-sub">BILL</p>
    <p>${escapeHtml(bill.number)}</p>
    <p>${new Date(bill.createdAt).toLocaleString("en-IN")}</p>
    <p>${escapeHtml(bill.customer || "Walk-in")}</p>
    <div class="rc-rule"></div>
    ${rows}
    <div class="rc-rule"></div>
    <p class="rc-total"><span>TOTAL</span><span>${money(bill.grandTotal)}</span></p>
    <p class="rc-sub">No GST</p>
    <p class="rc-thanks">Thank you</p>
  `;
}

function receiptHtml(bill) {
  return `<article class="receipt">${receiptInner(bill)}</article>`;
}

state.previewBillId = null;

function showHistoryBill(id) {
  const bill = state.bills.find((b) => b.id === id);
  const wrap = document.getElementById("bill-preview-wrap");
  if (!bill) {
    wrap.hidden = true;
    state.previewBillId = null;
    return;
  }
  state.previewBillId = id;
  document.getElementById("bill-preview").innerHTML = receiptInner(bill);
  wrap.hidden = false;
}

const BLE_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "0000ae30-0000-1000-8000-00805f9b34fb",
  "0000ffb0-0000-1000-8000-00805f9b34fb",
  "0000fff0-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "e7810a71-73ac-3050-50a7-d64aa3b1e4e0",
];

const bt = {
  device: null,
  char: null,
  port: null,
  pendingBill: null,
};

function printerMsg(text) {
  const el = document.getElementById("printer-msg");
  if (el) el.textContent = text || "";
}

function printerReady() {
  return Boolean((bt.char && bt.device) || (bt.port && bt.port.writable));
}

function updatePrinterLabel() {
  const box = document.querySelector(".printer-status");
  const label = document.getElementById("printer-label");
  const btn = document.getElementById("btn-connect-bt");
  const hint = document.getElementById("print-hint");
  const ready = printerReady();
  if (box) box.classList.toggle("is-on", ready);
  if (label) {
    label.textContent = ready
      ? "Connected: " + (bt.device?.name || "Bluetooth printer")
      : "Printer not connected";
  }
  if (btn) btn.textContent = ready ? "Change printer" : "Connect Bluetooth";
  if (hint) {
    hint.textContent = ready
      ? "Print bill sends this bill to your 55mm Bluetooth printer."
      : "Turn on the printer’s Bluetooth, tap Connect Bluetooth, pick the 55mm printer, then Print bill.";
  }
}

function openPrinterModal() {
  const root = document.getElementById("printer-modal-root");
  if (!root) return;
  printerMsg("");
  root.hidden = false;
}

function closePrinterModal() {
  const root = document.getElementById("printer-modal-root");
  if (root) root.hidden = true;
}

function ascii(str) {
  return String(str || "")
    .replace(/₹/g, "Rs ")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E\n]/g, "?");
}

function padLine(left, right, width) {
  const l = ascii(left);
  const r = ascii(right);
  return l + " ".repeat(Math.max(1, width - l.length - r.length)) + r;
}

function centerLine(text, width) {
  const t = ascii(text).slice(0, width);
  return " ".repeat(Math.max(0, Math.floor((width - t.length) / 2))) + t;
}

function receiptText(bill) {
  const w = 32;
  const lines = [
    centerLine(state.shop.name || BUSINESS, w),
    centerLine("BILL", w),
    "-".repeat(w),
    ascii(bill.number || ""),
    ascii(new Date(bill.createdAt).toLocaleString("en-IN")),
    ascii("Cust: " + (bill.customer || "Walk-in")),
    "-".repeat(w),
  ];
  (bill.lines || []).forEach((raw) => {
    const line = normalizeLine(raw);
    const qty = line.soldBy === "unit" ? `${line.qty} u` : `${Number(line.qty).toFixed(2)} kg`;
    const amt = lineAmount(line);
    lines.push(ascii(line.name));
    lines.push(padLine(`${qty} x Rs ${Number(line.rate).toFixed(2)}`, `Rs ${amt.toFixed(2)}`, w));
  });
  lines.push("-".repeat(w));
  lines.push(padLine("TOTAL", `Rs ${Number(bill.grandTotal || 0).toFixed(2)}`, w));
  lines.push(centerLine("No GST", w));
  lines.push(centerLine("Thank you", w));
  lines.push("", "", "", "");
  return lines.join("\n") + "\n";
}

function escPosBytes(bill) {
  const ESC = 0x1b;
  const GS = 0x1d;
  const init = Uint8Array.from([ESC, 0x40, ESC, 0x61, 0x00]);
  const body = new TextEncoder().encode(receiptText(bill));
  const cut = Uint8Array.from([GS, 0x56, 0x41, 0x03]);
  const out = new Uint8Array(init.length + body.length + cut.length);
  out.set(init, 0);
  out.set(body, init.length);
  out.set(cut, init.length + body.length);
  return out;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeChunks(writeFn, bytes, size) {
  for (let i = 0; i < bytes.length; i += size) {
    await writeFn(bytes.slice(i, i + size));
    await delay(20);
  }
}

async function findPrinterChar(server) {
  const services = [];
  try {
    services.push(...(await server.getPrimaryServices()));
  } catch {
    for (const uuid of BLE_SERVICES) {
      try {
        services.push(await server.getPrimaryService(uuid));
      } catch {
        /* skip missing service */
      }
    }
  }
  for (const service of services) {
    try {
      const chars = await service.getCharacteristics();
      const writable = chars.find(
        (c) => c.properties.writeWithoutResponse || c.properties.write || c.properties.reliableWrite
      );
      if (writable) return writable;
    } catch {
      /* skip */
    }
  }
  return null;
}

async function connectBluetoothPrinter() {
  printerMsg("Opening Bluetooth list…");
  try {
    if (!navigator.bluetooth) {
      printerMsg("Use Chrome or Edge. Firefox cannot connect Bluetooth printers.");
      return;
    }
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: BLE_SERVICES,
    });
    printerMsg("Connecting to " + (device.name || "printer") + "…");
    const server = await device.gatt.connect();
    const char = await findPrinterChar(server);
    if (!char) {
      printerMsg("That Bluetooth device has no print channel. Try COM port if Windows already paired it.");
      return;
    }
    bt.device = device;
    bt.char = char;
    bt.port = null;
    device.addEventListener("gattserverdisconnected", () => {
      bt.char = null;
      bt.device = null;
      updatePrinterLabel();
    });
    printerMsg("Connected.");
    updatePrinterLabel();
    closePrinterModal();
    if (bt.pendingBill) {
      const bill = bt.pendingBill;
      bt.pendingBill = null;
      await sendToPrinter(bill);
    }
  } catch (err) {
    if (err && err.name === "NotFoundError") printerMsg("No Bluetooth printer selected.");
    else printerMsg((err && err.message) || "Bluetooth connect failed. Turn on the printer and try again.");
  }
}

async function connectSerialPrinter() {
  printerMsg("Opening port list…");
  try {
    if (!navigator.serial) {
      printerMsg("COM port needs Chrome or Edge.");
      return;
    }
    const port = await navigator.serial.requestPort();
    if (!port.readable) await port.open({ baudRate: 9600 });
    bt.port = port;
    bt.char = null;
    port.addEventListener("disconnect", () => {
      bt.port = null;
      updatePrinterLabel();
    });
    printerMsg("COM printer connected.");
    updatePrinterLabel();
    closePrinterModal();
    if (bt.pendingBill) {
      const bill = bt.pendingBill;
      bt.pendingBill = null;
      await sendToPrinter(bill);
    }
  } catch (err) {
    if (err && err.name === "NotFoundError") printerMsg("No port selected.");
    else printerMsg((err && err.message) || "COM connect failed.");
  }
}

async function sendToPrinter(bill) {
  const bytes = escPosBytes(bill);
  if (bt.char) {
    const noResp = bt.char.properties.writeWithoutResponse;
    await writeChunks(async (chunk) => {
      if (noResp) await bt.char.writeValueWithoutResponse(chunk);
      else await bt.char.writeValue(chunk);
    }, bytes, 20);
    return;
  }
  if (bt.port) {
    if (!bt.port.writable) await bt.port.open({ baudRate: 9600 });
    const writer = bt.port.writable.getWriter();
    try {
      await writeChunks((chunk) => writer.write(chunk), bytes, 64);
    } finally {
      writer.releaseLock();
    }
    return;
  }
  throw new Error("Printer not connected");
}

function currentDraftBill() {
  const editing = state.bills.find((b) => b.id === state.draft.billId);
  return {
    number: editing?.number || "DRAFT",
    createdAt: editing?.createdAt || new Date().toISOString(),
    customer: state.draft.customer,
    lines: state.draft.lines,
    grandTotal: draftTotal(),
  };
}

function printCurrentBill() {
  if (!state.draft.lines.length) {
    alert("Add at least one vessel to print.");
    return;
  }
  printBill(currentDraftBill());
}

function printPreviewBill() {
  const bill = state.bills.find((b) => b.id === state.previewBillId);
  if (bill) printBill(bill);
}

async function printBill(bill) {
  if (!printerReady()) {
    bt.pendingBill = bill;
    openPrinterModal();
    printerMsg("Connect the 55mm Bluetooth printer, then this bill will print.");
    return;
  }
  try {
    await sendToPrinter(bill);
  } catch (err) {
    bt.pendingBill = bill;
    openPrinterModal();
    printerMsg((err && err.message) || "Print failed. Connect the printer again.");
    updatePrinterLabel();
  }
}

function saveBill() {
  if (!state.draft.lines.length) {
    alert("Add at least one vessel to the bill.");
    return;
  }
  const now = new Date();
  const existing = state.bills.find((b) => b.id === state.draft.billId);
  const payload = {
    customer: state.draft.customer.trim(),
    lines: state.draft.lines.map((line) => {
      const n = normalizeLine(line);
      return { ...n, amount: lineAmount(n) };
    }),
    grandTotal: draftTotal(),
  };
  if (existing) {
    Object.assign(existing, payload, { updatedAt: now.toISOString() });
  } else {
    state.bills.push({
      id: uid(),
      number: nextBillNo(now),
      createdAt: now.toISOString(),
      ...payload,
    });
  }
  persist();
  const saved = existing || state.bills[state.bills.length - 1];
  state.draft = { customer: "", lines: [], billId: null };
  persist();
  renderBill();
  state.previewBillId = saved.id;
  setView("history");
  renderHistory();
}

function editBill(id) {
  const bill = state.bills.find((b) => b.id === id);
  if (!bill) return;
  if (state.draft.lines.length && !state.draft.billId && !confirm("Replace the current draft with this bill?")) {
    return;
  }
  state.draft = {
    billId: bill.id,
    customer: bill.customer || "",
    lines: bill.lines.map(normalizeLine),
  };
  persist();
  setView("billing");
  renderBill();
}

function deleteBill(id) {
  const bill = state.bills.find((b) => b.id === id);
  if (!bill) return;
  if (!confirm(`Delete bill ${bill.number}?`)) return;
  state.bills = state.bills.filter((b) => b.id !== id);
  if (state.draft.billId === id) state.draft = { customer: "", lines: [], billId: null };
  if (state.previewBillId === id) {
    state.previewBillId = null;
    document.getElementById("bill-preview-wrap").hidden = true;
  }
  persist();
  renderBill();
  renderHistory();
}

function newBill() {
  if (state.draft.lines.length && !confirm("Clear the current bill?")) return;
  state.draft = { customer: "", lines: [], billId: null };
  persist();
  renderBill();
}

function renderAll() {
  document.getElementById("shop-name").value = state.shop.name;
  document.getElementById("shop-mark").textContent = initials(state.shop.name || BUSINESS);
  renderClock();
  renderGrid();
  renderMenu();
  renderBill();
  renderHistory();
}

function bind() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.view));
  });

  document.getElementById("shop-name").addEventListener("input", (e) => {
    state.shop.name = e.target.value || BUSINESS;
    document.getElementById("shop-mark").textContent = initials(state.shop.name);
    persist();
  });

  document.getElementById("search").addEventListener("input", (e) => {
    state.search = e.target.value;
    renderGrid();
  });

  document.getElementById("btn-add-vessel").addEventListener("click", () => openVesselModal());
  document.getElementById("btn-add-vessel-menu").addEventListener("click", () => {
    setView("menu");
    openVesselModal();
  });
  document.getElementById("btn-cancel-vessel").addEventListener("click", closeVesselModal);
  document.getElementById("modal-root").addEventListener("click", (e) => {
    if (e.target.id === "modal-root") closeVesselModal();
  });
  document.getElementById("qty-modal-root").addEventListener("click", (e) => {
    if (e.target.id === "qty-modal-root") closeQtyPrompt();
  });
  document.getElementById("btn-cancel-qty").addEventListener("click", closeQtyPrompt);

  document.querySelectorAll('input[name="sold-by"]').forEach((el) => {
    el.addEventListener("change", () => syncSoldByLabels(selectedSoldBy()));
  });

  document.getElementById("photo-frame").addEventListener("click", () => {
    document.getElementById("vessel-image").click();
  });

  document.getElementById("vessel-image").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      state.imageData = await compressImage(file);
      paintPhoto();
    } catch {
      alert("Could not use that image.");
    }
  });

  document.getElementById("vessel-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("vessel-name").value.trim();
    const soldBy = selectedSoldBy();
    const defaultQty = Number(document.getElementById("vessel-qty").value);
    const rate = Number(document.getElementById("vessel-price").value);
    if (!name || defaultQty <= 0 || rate < 0) {
      alert("Enter a name, quantity, and price.");
      return;
    }
    const payload = { name, soldBy, defaultQty, rate, image: state.imageData };
    if (state.editingId) {
      const vessel = state.vessels.find((v) => v.id === state.editingId);
      Object.assign(vessel, payload);
    } else {
      state.vessels.push({ id: uid(), ...payload });
    }
    persist();
    closeVesselModal();
    renderGrid();
    renderMenu();
  });

  document.getElementById("qty-form").addEventListener("submit", (e) => {
    e.preventDefault();
    commitQtyToBill(Number(document.getElementById("qty-input").value));
  });

  document.getElementById("customer").addEventListener("input", (e) => {
    state.draft.customer = e.target.value;
    persist();
  });

  document.getElementById("btn-save").addEventListener("click", saveBill);
  document.getElementById("btn-new-bill").addEventListener("click", newBill);
  document.getElementById("btn-delete-preview").addEventListener("click", () => {
    if (state.previewBillId) deleteBill(state.previewBillId);
  });
  document.getElementById("btn-close-preview").addEventListener("click", () => {
    state.previewBillId = null;
    document.getElementById("bill-preview-wrap").hidden = true;
    renderHistory();
  });

  document.getElementById("month-filter").addEventListener("change", (e) => {
    state.month = e.target.value;
    renderHistory();
  });

  document.body.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) openQtyPrompt(add.dataset.add);

    const edit = e.target.closest("[data-edit]");
    if (edit) openVesselModal(edit.dataset.edit);

    const del = e.target.closest("[data-delete]");
    if (del) deleteVessel(del.dataset.delete);

    const remove = e.target.closest("[data-remove]");
    if (remove) {
      state.draft.lines = state.draft.lines.filter((l) => l.id !== remove.dataset.remove);
      persist();
      renderBill();
    }

    const viewBill = e.target.closest("[data-view-bill]");
    if (viewBill) showHistoryBill(viewBill.dataset.viewBill);

    const printBtn = e.target.closest("[data-print-bill]");
    if (printBtn) {
      const bill = state.bills.find((b) => b.id === printBtn.dataset.printBill);
      if (bill) printBill(bill);
    }

    const editBillBtn = e.target.closest("[data-edit-bill]");
    if (editBillBtn) editBill(editBillBtn.dataset.editBill);

    const delBill = e.target.closest("[data-delete-bill]");
    if (delBill) deleteBill(delBill.dataset.deleteBill);
  });

  document.body.addEventListener("change", (e) => {
    const price = e.target.closest("[data-price]");
    if (price) updateVesselPrice(price.dataset.price, price.value);

    const menuQty = e.target.closest("[data-menu-qty]");
    if (menuQty) {
      const vessel = state.vessels.find((v) => v.id === menuQty.dataset.menuQty);
      if (vessel) {
        vessel.defaultQty = Number(menuQty.value) || vessel.defaultQty;
        persist();
      }
    }

    const menuSold = e.target.closest("[data-menu-sold]");
    if (menuSold) {
      const vessel = state.vessels.find((v) => v.id === menuSold.dataset.menuSold);
      if (vessel) {
        vessel.soldBy = menuSold.value === "unit" ? "unit" : "weight";
        persist();
        renderGrid();
        renderMenu();
      }
    }

    const lineQty = e.target.closest("[data-line-qty]");
    if (lineQty) {
      const line = state.draft.lines.find((l) => l.id === lineQty.dataset.lineQty);
      if (line) {
        line.qty = Number(lineQty.value) || 0.01;
        persist();
        renderBill();
      }
    }

    const lineRate = e.target.closest("[data-line-rate]");
    if (lineRate) {
      const line = state.draft.lines.find((l) => l.id === lineRate.dataset.lineRate);
      if (line) {
        line.rate = Number(lineRate.value) || 0;
        persist();
        renderBill();
      }
    }
  });

  setInterval(renderClock, 30000);
  updatePrinterLabel();
}

persist();
renderAll();
bind();
