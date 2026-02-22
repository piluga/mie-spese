        // 1. PRIMA COSA: Definiamo lo StorageManager
        const StorageManager = {
            keys: {
                tx: 'spese_v3_data',
                acc: 'spese_v3_accounts',
                rec: 'spese_v3_recurring',
                apiKey: 'gemini_api_key'
            },
            _get(key, defaultValue) {
                try {
                    const data = localStorage.getItem(key);
                    return data ? JSON.parse(data) : defaultValue;
                } catch (error) {
                    console.error(`Errore nel caricamento di ${key}:`, error);
                    return defaultValue;
                }
            },
            _set(key, value) {
                try {
                    localStorage.setItem(key, JSON.stringify(value));
                } catch (error) {
                    console.error(`Errore nel salvataggio di ${key}:`, error);
                    alert("Errore di memoria: Impossibile salvare i dati.");
                }
            },

            getTransactions: () => StorageManager._get(StorageManager.keys.tx, []),
            saveTransactions: (data) => StorageManager._set(StorageManager.keys.tx, data),
            getAccounts: () => StorageManager._get(StorageManager.keys.acc, [{ id: 'acc_01', name: 'Conto Corrente', budget: 0, initialBalance: 0 }]),
            saveAccounts: (data) => StorageManager._set(StorageManager.keys.acc, data),
            getRecurring: () => StorageManager._get(StorageManager.keys.rec, []),
            saveRecurring: (data) => StorageManager._set(StorageManager.keys.rec, data),
            getApiKey: () => localStorage.getItem(StorageManager.keys.apiKey) || "",
            saveApiKey: (key) => localStorage.setItem(StorageManager.keys.apiKey, key),
            removeApiKey: () => localStorage.removeItem(StorageManager.keys.apiKey),
            clearAll: () => localStorage.clear()
        };

        // --- FUNZIONE DI SICUREZZA ANTI-XSS ---
        function escapeHTML(str) {
            if (!str) return '';
            return str.toString()
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        // 2. ORA inizializziamo le variabili globali (una sola volta!)
        let apiKey = StorageManager.getApiKey();
        let recurringTxs = StorageManager.getRecurring();
        let transactions = StorageManager.getTransactions();
        let rawAccounts = StorageManager.getAccounts();
        let accounts = rawAccounts.map(a => ({ ...a, budget: a.budget || 0, initialBalance: a.initialBalance || 0 }));

        let activeAccountId = accounts[0].id;
        let viewDate = new Date();
        let currentMode = 'expense';
        let selectedCategory = 'altro';
        let editingTxId = null;
        let chartInstance = null;
        let numberCallback = null;

        // UI TOAST
        function showToast(msg) {
            const t = document.getElementById('toast');
            t.textContent = msg;
            t.style.opacity = '1';
            setTimeout(() => t.style.opacity = '0', 2500);
        }

        function renderSettingsRecurring() {
            const list = document.getElementById('recurring-list-settings');
            if (recurringTxs.length === 0) {
                list.innerHTML = `<p class="text-[11px] text-slate-400 italic">Nessuna transazione ricorrente attiva.</p>`;
                return;
            }

            list.innerHTML = recurringTxs.map(rec => {
                const isInc = rec.type === 'income';
                const color = isInc ? 'text-emerald-600' : 'text-rose-600';
                const freqText = rec.frequency === 'monthly' ? 'Mensile' : (rec.frequency === 'weekly' ? 'Settimanale' : 'Annuale');

                return `
                <div class="p-3 border border-slate-100 rounded-xl bg-slate-50 flex items-center justify-between">
                    <div class="overflow-hidden mr-2">
                        <span class="font-bold text-sm truncate text-slate-700">${rec.description || 'Senza nome'}</span>
                        <div class="text-[10px] text-slate-500 font-medium mt-0.5">
                            <span class="${color} font-bold">€ ${rec.amount.toFixed(2)}</span> • ${freqText} • Prossima: ${getFriendlyDate(rec.nextDate)}
                        </div>
                    </div>
                    <button onclick="deleteRecurring('${rec.id}')" class="w-8 h-8 rounded-lg bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100 transition-colors shrink-0">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>`;
            }).join('');
        }

        function deleteRecurring(id) {
            if (confirm("Vuoi annullare questa transazione ricorrente? (I movimenti passati non verranno eliminati)")) {
                recurringTxs = recurringTxs.filter(r => r.id !== id);
                StorageManager.saveRecurring(recurringTxs);
                renderSettingsRecurring();
                showToast("Ricorrenza eliminata");
            }
        }

        // --- GESTIONE MODALI DI SISTEMA ---
        function showSimpleAlert(title, message) {
            document.getElementById('alert-title').textContent = title;
            document.getElementById('alert-message').textContent = message;
            document.getElementById('simple-alert-modal').classList.remove('hidden');
        }

        function closeSimpleAlert() {
            document.getElementById('simple-alert-modal').classList.add('hidden');
        }

        function openNumberModal(title, value, callback) {
            document.getElementById('numberTitle').innerText = title;
            const input = document.getElementById('numberInput');
            input.value = value ?? '';
            numberCallback = callback;
            document.getElementById('numberModal').classList.remove('hidden');
            setTimeout(() => input.focus(), 50);
        }

        function closeNumberModal() {
            document.getElementById('numberModal').classList.add('hidden');
            numberCallback = null;
        }

        function confirmNumberModal() {
            if (!numberCallback) return;
            const raw = document.getElementById('numberInput').value.replace(',', '.');
            const val = parseFloat(raw);
            if (isNaN(val)) {
                showSimpleAlert("Attenzione", "Inserisci un numero valido");
                return;
            }
            numberCallback(val);
            closeNumberModal();
        }

        // --- BACKUP & EXPORT ---
        function getBackupData() {
            const timestamp = new Date().toISOString().split('T')[0];
            const filename = `backup_spesepro_${timestamp}.json`;
            const data = { app: "SpesePro", version: "3.2", exportedAt: new Date().toISOString(), transactions, accounts };
            return { json: JSON.stringify(data, null, 2), filename };
        }

        async function saveToFileSystem() {
            const { json, filename } = getBackupData();
            if ('showSaveFilePicker' in window) {
                try {
                    const handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'JSON File', accept: { 'application/json': ['.json'] } }] });
                    const writable = await handle.createWritable();
                    await writable.write(json);
                    await writable.close();
                    showToast("Salvato su disco!");
                } catch (err) {
                    if (err.name !== 'AbortError') showToast("Salvataggio annullato");
                }
            } else {
                downloadBackupManual(json, filename);
            }
        }

        function downloadBackupManual(json, filename) {
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); showToast("Backup scaricato!"); }, 100);
        }

        function exportCSV() {
            const headers = ["Data", "Descrizione", "Importo", "Categoria", "Tipo", "Conto", "Budget Conto"];
            const rows = transactions.map(t => {
                const acc = accounts.find(a => a.id === t.accountId);
                return [
                    new Date(t.date).toLocaleDateString(),
                    t.description || '',
                    t.amount.toFixed(2),
                    t.category,
                    t.type,
                    acc?.name || "N/A",
                    acc?.budget || 0
                ].join(';')
            });
            const blob = new Blob(["\ufeff" + [headers.join(';'), ...rows].join('\n')], { type: 'text/csv' });
            downloadBackupManual(blob, `spese_export.csv`);
        }

        function importJSON(event) {
            const file = event.target.files[0];
            if (!file) return;
            const r = new FileReader();
            r.onload = (e) => {
                try {
                    const d = JSON.parse(e.target.result);
                    if (confirm("Vuoi ripristinare il backup? I dati attuali andranno persi.")) {
                        transactions = d.transactions || [];
                        accounts = d.accounts || accounts;
                        StorageManager.saveTransactions(transactions);
                        StorageManager.saveAccounts(accounts);
                        location.reload();
                    }
                } catch { showToast("File non valido"); }
            };
            r.readAsText(file);
        }

        // --- CONTI ---
        function openAddAccountModal() {
            document.getElementById('modal-new-name').value = '';
            document.getElementById('modal-new-balance').value = '';
            document.getElementById('modal-new-budget').value = '';
            document.getElementById('new-account-modal').classList.remove('hidden');
            setTimeout(() => document.getElementById('modal-new-name').focus(), 50);
        }
        function closeAddAccountModal() { document.getElementById('new-account-modal').classList.add('hidden'); }

        function confirmAddAccount() {
            const name = document.getElementById('modal-new-name').value.trim();
            const initialBalance = parseFloat(document.getElementById('modal-new-balance').value.replace(',', '.')) || 0;
            const budget = parseFloat(document.getElementById('modal-new-budget').value.replace(',', '.')) || 0;

            if (!name) { showSimpleAlert("Nome Mancante", "Per favore, inserisci un nome per il conto."); return; }

            const newAccount = { id: 'acc_' + Date.now(), name, budget, initialBalance };
            accounts.push(newAccount);
            if (accounts.length === 1) activeAccountId = newAccount.id;

            StorageManager.saveAccounts(accounts);
            renderSettingsAccounts(); updateUI(); closeAddAccountModal(); showToast("Conto creato!");
        }

        let accountToRenameId = null;
        function renameAccount(id) {
            accountToRenameId = id;
            const acc = accounts.find(a => a.id === id);
            if (!acc) return;
            document.getElementById('rename-input').value = acc.name;
            document.getElementById('rename-modal').classList.remove('hidden');
            setTimeout(() => document.getElementById('rename-input').focus(), 50);
        }
        function closeRenameModal() { document.getElementById('rename-modal').classList.add('hidden'); accountToRenameId = null; }
        function confirmRename() {
            if (!accountToRenameId) return;
            const newName = document.getElementById('rename-input').value.trim();
            if (newName) {
                const acc = accounts.find(a => a.id === accountToRenameId);
                if (acc) { acc.name = newName; StorageManager.saveAccounts(accounts); renderSettingsAccounts(); updateUI(); }
            }
            closeRenameModal();
        }

        let accountToDeleteId = null;
        function deleteAccount(id) {
            if (accounts.length === 1) { showSimpleAlert("Impossibile Eliminare", "Non puoi eliminare l'unico conto rimasto."); return; }
            accountToDeleteId = id;
            const txCount = transactions.filter(t => t.accountId === id).length;
            const optionsDiv = document.getElementById('delete-options');
            document.querySelector('input[name="del-strategy"][value="delete"]').checked = true;
            toggleMoveSelect(false);

            if (txCount > 0) {
                optionsDiv.classList.remove('hidden');
                document.getElementById('del-tx-count').textContent = txCount;
                document.getElementById('target-acc-select').innerHTML = accounts.filter(a => a.id !== id).map(a => `<option value="${a.id}">${a.name}</option>`).join('');
            } else { optionsDiv.classList.add('hidden'); }
            document.getElementById('delete-account-modal').classList.remove('hidden');
        }
        function toggleMoveSelect(show) { document.getElementById('target-acc-container').classList.toggle('hidden', !show); }
        function closeDeleteModal() { document.getElementById('delete-account-modal').classList.add('hidden'); accountToDeleteId = null; }

        function confirmDeleteAccount() {
            if (!accountToDeleteId) return;
            const txCount = transactions.filter(t => t.accountId === accountToDeleteId).length;
            if (txCount > 0) {
                const strategy = document.querySelector('input[name="del-strategy"]:checked').value;
                if (strategy === 'move') {
                    const targetId = document.getElementById('target-acc-select').value;
                    if (!targetId) return;
                    transactions.forEach(t => { if (t.accountId === accountToDeleteId) t.accountId = targetId; });
                } else { transactions = transactions.filter(t => t.accountId !== accountToDeleteId); }
            }
            accounts = accounts.filter(a => a.id !== accountToDeleteId);
            if (activeAccountId === accountToDeleteId) activeAccountId = accounts[0].id;
            StorageManager.saveAccounts(accounts); StorageManager.saveTransactions(transactions);
            renderSettingsAccounts(); updateUI(); closeDeleteModal(); showToast("Conto eliminato");
        }

        function setBudget(id) {
            const acc = accounts.find(a => a.id === id);
            if (!acc) return;
            openNumberModal("Budget mensile (€)", acc.budget || 0, val => {
                acc.budget = val; StorageManager.saveAccounts(accounts); renderSettingsAccounts(); updateUI();
            });
        }

        function setInitialBalance(id) {
            const acc = accounts.find(a => a.id === id);
            if (!acc) return;
            openNumberModal("Saldo iniziale (€)", acc.initialBalance || 0, val => {
                acc.initialBalance = val; StorageManager.saveAccounts(accounts); renderSettingsAccounts(); updateUI();
            });
        }

        // --- RENDER IMPOSTAZIONI ---
        function toggleSettings(show) {
            const main = document.getElementById('main-view');
            const settings = document.getElementById('settings-view');
            const backBtn = document.getElementById('btn-back');

            if (show) {
                renderSettingsAccounts();
                renderSettingsRecurring();
                main.classList.add('hidden');
                settings.classList.remove('hidden');
                backBtn.classList.remove('hidden');
            } else {
                main.classList.remove('hidden');
                settings.classList.add('hidden');
                backBtn.classList.add('hidden');
                updateUI();
            }
        }

        function renderSettingsAccounts() {
            const list = document.getElementById('account-list-settings');
            list.innerHTML = accounts.map(a => `
                                <div class="p-3 border border-slate-100 rounded-xl bg-slate-50 flex items-center justify-between">
                                    <div class="overflow-hidden mr-2">
                                        <span class="font-bold text-sm truncate ${a.id === activeAccountId ? 'text-blue-600' : 'text-slate-700'}">${escapeHTML(a.name)}</span>
                                        <div class="text-[10px] text-slate-500 font-medium mt-0.5">Saldo: € ${(a.initialBalance || 0).toLocaleString('it-IT')} | Budget: € ${(a.budget || 0).toLocaleString('it-IT')}</div>
                                    </div>
                                    <div class="flex gap-1 shrink-0">
                                        <button onclick="setInitialBalance('${a.id}')" class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center hover:bg-emerald-100 transition-colors"><i class="fa-solid fa-coins"></i></button>
                                        <button onclick="setBudget('${a.id}')" class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-100 transition-colors"><i class="fa-solid fa-bullseye"></i></button>
                                        <button onclick="renameAccount('${a.id}')" class="w-8 h-8 rounded-lg bg-slate-200 text-slate-500 flex items-center justify-center hover:bg-slate-300 transition-colors"><i class="fa-solid fa-pen"></i></button>
                                        <button onclick="deleteAccount('${a.id}')" class="w-8 h-8 rounded-lg bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-100 transition-colors"><i class="fa-solid fa-trash"></i></button>
                                    </div>
                                </div>`).join('');
        }

        // --- ACCOUNT PICKER ---
        function openAccountPicker() {
            const list = document.getElementById('account-picker-list');
            const currentId = document.getElementById('modal-account-select')?.value || activeAccountId;

            list.innerHTML = accounts.map(a => {
                const isSelected = a.id === currentId;
                const activeClass = isSelected ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-100 hover:bg-slate-50';
                return `
                                    <button onclick="pickAccount('${a.id}', '${a.name}')" class="w-full flex items-center justify-between p-4 border rounded-xl ${activeClass} transition-colors text-left">
                                        <div class="flex items-center gap-3">
                                            <div class="w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-lg"><i class="fa-solid fa-building-columns"></i></div>
                                            <div>
                                                <div class="font-bold text-slate-800 text-sm">${a.name}</div>
                                                <div class="text-[10px] text-slate-400">Saldo Iniziale: € ${a.initialBalance}</div>
                                            </div>
                                        </div>
                                        ${isSelected ? '<i class="fa-solid fa-check text-blue-600"></i>' : ''}
                                    </button>`;
            }).join('');
            document.getElementById('account-picker-modal').classList.remove('hidden');
        }
        function closeAccountPicker() { document.getElementById('account-picker-modal').classList.add('hidden'); }
        function pickAccount(id, name) {
            const selectEl = document.getElementById('modal-account-select');
            if (selectEl) {
                selectEl.value = id;
                document.getElementById('selected-account-display').textContent = name;
            } else {
                activeAccountId = id;
                updateUI();
            }
            closeAccountPicker();
        }

        // --- TRANSACTIONS ---
        function getFriendlyDate(dateStr) {
            const d = new Date(dateStr);
            const today = new Date().toISOString().split('T')[0];
            const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
            if (dateStr === today) return 'Oggi';
            if (dateStr === yesterday) return 'Ieri';
            return d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long' });
        }

        // --- LOGICA GIROCONTO ---
        function openTransferModal() {
            if (accounts.length < 2) {
                showSimpleAlert("Attenzione", "Devi avere almeno due conti configurati per effettuare un giroconto.");
                return;
            }

            const fromSelect = document.getElementById('transfer-from');
            const toSelect = document.getElementById('transfer-to');

            // Popola le tendine
            const options = accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
            fromSelect.innerHTML = options;
            toSelect.innerHTML = options;

            // Pre-seleziona i conti
            fromSelect.value = activeAccountId;
            toSelect.value = accounts.find(a => a.id !== activeAccountId)?.id || accounts[0].id;

            // Reset valori
            document.getElementById('transfer-amount').value = '';
            document.getElementById('transfer-date').value = new Date().toISOString().split('T')[0];

            document.getElementById('transfer-modal').classList.remove('hidden');
            setTimeout(() => document.getElementById('transfer-amount').focus(), 50);
        }

        function closeTransferModal() {
            document.getElementById('transfer-modal').classList.add('hidden');
        }

        function saveTransfer() {
            const amt = parseFloat(document.getElementById('transfer-amount').value);
            if (isNaN(amt) || amt <= 0) { showSimpleAlert("Attenzione", "Inserisci un importo valido."); return; }

            const fromId = document.getElementById('transfer-from').value;
            const toId = document.getElementById('transfer-to').value;

            if (fromId === toId) {
                showSimpleAlert("Attenzione", "Il conto di origine e quello di destinazione non possono essere gli stessi.");
                return;
            }

            const fromAcc = accounts.find(a => a.id === fromId);
            const toAcc = accounts.find(a => a.id === toId);
            const selectedDate = document.getElementById('transfer-date').value;
            const isoDate = selectedDate ? new Date(selectedDate + 'T12:00:00').toISOString() : new Date().toISOString();

            const txId1 = Date.now();
            const txId2 = txId1 + 1; // Unico escamotage per garantire ID diversi se creati nello stesso millisecondo

            // 1. Uscita dal conto di origine
            transactions.push({
                id: txId1,
                amount: amt,
                description: `Giroconto verso ${toAcc.name}`,
                category: 'altro',
                type: 'expense',
                accountId: fromId,
                date: isoDate,
                linkedId: txId2 // Li leghiamo assieme!
            });

            // 2. Entrata nel conto di destinazione
            transactions.push({
                id: txId2,
                amount: amt,
                description: `Giroconto da ${fromAcc.name}`,
                category: 'altro_in',
                type: 'income',
                accountId: toId,
                date: isoDate,
                linkedId: txId1 // Li leghiamo assieme!
            });

            StorageManager.saveTransactions(transactions);
            updateUI();
            closeTransferModal();
            showToast("Giroconto completato!");
        }

        function toggleGroup(dateKey) {
            const list = document.getElementById(`group-list-${dateKey}`);
            const icon = document.getElementById(`group-icon-${dateKey}`);
            list.classList.toggle('hidden');
            icon.classList.toggle('rotate-180');
        }

        function changeMonth(d) { viewDate.setMonth(viewDate.getMonth() + d); updateUI(); }

        function updateUI() {
            const m = viewDate.getMonth();
            const y = viewDate.getFullYear();
            let currentAcc = accounts.find(a => a.id === activeAccountId);
            if (!currentAcc && accounts.length) { activeAccountId = accounts[0].id; currentAcc = accounts[0]; }

            document.getElementById('current-month-display').textContent = viewDate.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
            document.getElementById('account-name-display').innerHTML = `<span class="w-2 h-2 rounded-full bg-green-500 inline-block"></span> <span>${currentAcc.name}</span> <i class="fa-solid fa-chevron-down ml-1 text-blue-400"></i>`;

            // Aggiorna pallini indicatori conti
            const dotsContainer = document.getElementById('account-dots');
            if (accounts.length > 1) {
                dotsContainer.innerHTML = accounts.map(a =>
                    `<div class="w-1.5 h-1.5 rounded-full ${a.id === activeAccountId ? 'bg-blue-500 scale-125' : 'bg-blue-200'} transition-all"></div>`
                ).join('');
                dotsContainer.classList.remove('hidden');
            } else {
                dotsContainer.classList.add('hidden');
            }

            const filtered = transactions.filter(t => {
                const d = new Date(t.date);
                return d.getMonth() === m && d.getFullYear() === y && t.accountId === activeAccountId;
            });

            const inc = filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
            const exp = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
            const bal = (currentAcc.initialBalance || 0) + inc - exp;

            const balEl = document.getElementById('balance');
            balEl.textContent = `€ ${bal.toLocaleString('it-IT', { minimumFractionDigits: 2 })}`;
            balEl.className = bal >= 0 ? 'text-4xl font-bold text-blue-900 tracking-tight' : 'text-4xl font-bold text-red-500 tracking-tight';

            const initEl = document.getElementById('initial-balance-display');
            if ((currentAcc.initialBalance || 0) !== 0) {
                initEl.textContent = `Saldo iniziale: € ${currentAcc.initialBalance.toLocaleString('it-IT', { minimumFractionDigits: 2 })}`;
                initEl.classList.remove('hidden');
            } else { initEl.classList.add('hidden'); }

            // Nuova gestione visiva del Budget Fissa con animazione dinamica
            const budgetContainer = document.getElementById('budget-container');
            const budget = currentAcc.budget || 0;

            if (budget > 0) {
                let perc = Math.min((exp / budget) * 100, 100);
                const isOverBudget = exp > budget;
                const barColorClass = isOverBudget ? 'bg-red-500' : 'bg-blue-500';
                const spentColorClass = isOverBudget ? 'text-red-600' : 'text-blue-800';

                // Disegna la barra inizialmente a larghezza 0%
                budgetContainer.innerHTML = `
                                    <div class="flex justify-between text-[10px] font-bold text-blue-600 uppercase mb-1.5">
                                        <span>Speso: <strong id="budget-spent" class="${spentColorClass}">€${exp.toLocaleString('it-IT', { minimumFractionDigits: 2 })}</strong></span>
                                        <span>Budget: <strong id="budget-total" class="text-blue-800">€${budget.toLocaleString('it-IT', { minimumFractionDigits: 2 })}</strong></span>
                                    </div>
                                    <div class="w-full bg-blue-100 rounded-full h-2 overflow-hidden">
                                        <div id="budget-bar" class="${barColorClass} h-full rounded-full transition-all duration-1000 ease-out" style="width: 0%"></div>
                                    </div>
                                `;

                // Attiva l'animazione applicando la larghezza reale un istante dopo
                setTimeout(() => {
                    const bar = document.getElementById('budget-bar');
                    if (bar) bar.style.width = perc + '%';
                }, 50);

            } else {
                budgetContainer.innerHTML = `
                                    <div class="flex items-center justify-center gap-2 text-xs font-bold text-blue-500 py-1">
                                        <i class="fa-solid fa-bullseye text-blue-400"></i> Imposta un Budget Mensile
                                    </div>
                                `;
            }

            const listEl = document.getElementById('transaction-list');
            const searchTerm = (document.getElementById('search-input')?.value || '').toLowerCase().trim();

            let listTransactions = filtered;
            if (searchTerm) {
                listTransactions = filtered.filter(t => {
                    const cat = [...categories.expense, ...categories.income].find(c => c.id === t.category);
                    return (t.description || '').toLowerCase().includes(searchTerm) || (cat && cat.label.toLowerCase().includes(searchTerm));
                });
            }

            if (listTransactions.length === 0) {
                listEl.innerHTML = `<div class="text-center py-10 opacity-50"><i class="fa-solid fa-receipt text-4xl text-slate-300 mb-3"></i><p class="text-sm font-bold text-slate-500">${searchTerm ? 'Nessun risultato' : 'Nessun movimento'}</p></div>`;
            } else {
                listTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));
                const groups = {};
                listTransactions.forEach(t => { const d = t.date.split('T')[0]; if (!groups[d]) groups[d] = []; groups[d].push(t); });

                listEl.innerHTML = Object.keys(groups).map(dateKey => {
                    const dailyTx = groups[dateKey];
                    const dailySum = dailyTx.reduce((acc, t) => t.type === 'income' ? acc + t.amount : acc - t.amount, 0);
                    const sumColor = dailySum >= 0 ? 'text-emerald-500' : 'text-slate-500';

                    const txHtml = dailyTx.map(t => {
                        const cat = [...categories.expense, ...categories.income].find(c => c.id === t.category);
                        const isInc = t.type === 'income';
                        const amountStr = `${isInc ? '+' : '-'} €${t.amount.toFixed(2)}`;

                        return `
                                        <div onclick="editTransaction(${t.id})" class="bg-white p-3 rounded-xl border border-slate-100 card-shadow mb-2 flex items-center justify-between cursor-pointer active:scale-98 transition-all relative overflow-hidden">
                                            <div class="flex items-center gap-3 overflow-hidden z-10">
                                                <div class="w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0 shadow-sm" style="background-color: ${cat?.color || '#94a3b8'}">
                                                    <i class="${cat?.icon || 'fa-solid fa-box'}"></i>
                                                </div>
                                                <div class="truncate">
                                                    <h4 class="font-bold text-slate-800 text-sm truncate leading-tight">${t.description || cat?.label}</h4>
                                                    <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">${cat?.label}</span>
                                                </div>
                                            </div>
                                            <span class="font-bold whitespace-nowrap text-sm z-10 ${isInc ? 'text-emerald-600' : 'text-slate-800'}">${amountStr}</span>
                                        </div>`;
                    }).join('');

                    return `
                                    <div class="mb-4">
                                        <div onclick="toggleGroup('${dateKey}')" class="flex justify-between items-center px-2 mb-2 cursor-pointer select-none">
                                            <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">${getFriendlyDate(dateKey)}</span>
                                            <div class="flex items-center gap-2">
                                                <span class="text-xs font-bold ${sumColor}">${dailySum > 0 ? '+' : ''}€${dailySum.toFixed(2)}</span>
                                                <i id="group-icon-${dateKey}" class="fa-solid fa-chevron-down text-slate-300 text-[10px] transition-transform rotate-180"></i>
                                            </div>
                                        </div>
                                        <div id="group-list-${dateKey}" class="space-y-0">${txHtml}</div>
                                    </div>`;
                }).join('');
            }
            renderChart(filtered.filter(t => t.type === 'expense'));
        }

function renderChart(exps) {
    const ctx = document.getElementById('expenseChart');
    const container = document.getElementById('chart-container');

    if (exps.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');

    const dataMap = {};
    let totalExpense = 0; // Inizializziamo il totale

    // Raggruppiamo i dati e calcoliamo il totale
    exps.forEach(e => {
        const label = categories.expense.find(c => c.id === e.category)?.label || 'Altro';
        dataMap[label] = (dataMap[label] || 0) + e.amount;
        totalExpense += e.amount;
    });

    if (chartInstance) chartInstance.destroy();

    // 1. Plugin Custom: Scrive il totale esatto al centro della ciambella
    const centerTextPlugin = {
        id: 'centerText',
        beforeDraw: function (chart) {
            if (chart.getDatasetMeta(0).data.length === 0) return;
            const ctx = chart.ctx;
            // Troviamo il centro esatto calcolato da Chart.js
            const centerX = chart.getDatasetMeta(0).data[0].x;
            const centerY = chart.getDatasetMeta(0).data[0].y;

            ctx.restore();

            // Stile per il numero (Totale)
            ctx.font = "bold 1.1rem Inter";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#1e293b"; // Colore slate-800
            const text = "€ " + totalExpense.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const textX = centerX - (ctx.measureText(text).width / 2);
            ctx.fillText(text, textX, centerY - 8);

            // Stile per l'etichetta "USCITE"
            ctx.font = "600 0.65rem Inter";
            ctx.fillStyle = "#94a3b8"; // Colore slate-400
            const subText = "USCITE";
            const subTextX = centerX - (ctx.measureText(subText).width / 2);
            ctx.fillText(subText, subTextX, centerY + 12);

            ctx.save();
        }
    };

            // 2. Creazione del nuovo grafico
            chartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: Object.keys(dataMap),
                    datasets: [{
                        data: Object.values(dataMap),
                        backgroundColor: Object.keys(dataMap).map(l => categories.expense.find(c => c.label === l)?.color || '#e2e8f0'),
                        borderWidth: 3, // Spazio bianco tra le fette
                        borderColor: '#ffffff',
                        hoverOffset: 6 // Effetto "Pop" al passaggio del mouse
                    }]
                },
                options: {
                    cutout: '78%', // Allarga il buco centrale per fare spazio al testo
                    maintainAspectRatio: false,
                    layout: {
                        padding: { top: 10, bottom: 10 }
                    },
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: {
                                boxWidth: 10,
                                padding: 15,
                                usePointStyle: true, // Usa pallini al posto dei quadrati
                                font: { size: 11, family: 'Inter', weight: '600' },
                                color: '#475569'
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(15, 23, 42, 0.9)', // Sfondo scuro elegante
                            titleFont: { family: 'Inter', size: 12 },
                            bodyFont: { family: 'Inter', size: 13, weight: 'bold' },
                            padding: 12,
                            cornerRadius: 12,
                            displayColors: true,
                            boxPadding: 4,
                            callbacks: {
                                // Formatta i valori nel tooltip come valuta
                                label: function (context) {
                                    let label = context.label || '';
                                    if (label) { label += ': '; }
                                    if (context.parsed !== null) {
                                        label += '€ ' + context.parsed.toLocaleString('it-IT', { minimumFractionDigits: 2 });
                                    }
                                    return label;
                                }
                            }
                        }
                    }
                },
                plugins: [centerTextPlugin] // Attiviamo il testo al centro
            });
        }

        // --- GESTIONE SWIPE PER CAMBIO CONTO ---
        let touchStartX = 0;
        let touchEndX = 0;

        const dashCard = document.getElementById('dashboard-card');

        dashCard.addEventListener('touchstart', e => {
            touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });

        dashCard.addEventListener('touchend', e => {
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        }, { passive: true });

        // --- FUNZIONI PER LE TRANSAZIONI RICORRENTI
        // Funzione per calcolare la data successiva

        function getNextDate(dateStr, freq) {
            const d = new Date(dateStr);
            if (freq === 'monthly') d.setMonth(d.getMonth() + 1);
            if (freq === 'weekly') d.setDate(d.getDate() + 7);
            if (freq === 'yearly') d.setFullYear(d.getFullYear() + 1);
            return d.toISOString().split('T')[0];
        }

        // Funzione "Motore" che controlla le scadenze all'apertura dell'app
        function processRecurringTransactions() {
            const today = new Date().toISOString().split('T')[0];
            let hasUpdates = false;

            recurringTxs.forEach(rec => {
                // Finché la data della prossima esecuzione è <= a oggi, genera la transazione
                while (rec.nextDate <= today) {
                    transactions.push({
                        id: Date.now() + Math.floor(Math.random() * 1000), // ID univoco
                        amount: rec.amount,
                        description: rec.description,
                        category: rec.category,
                        type: rec.type,
                        accountId: rec.accountId,
                        date: new Date(rec.nextDate + 'T12:00:00').toISOString()
                    });

                    // Aggiorna la data alla prossima ricorrenza
                    rec.nextDate = getNextDate(rec.nextDate, rec.frequency);
                    hasUpdates = true;
                }
            });

            if (hasUpdates) {
                StorageManager.saveTransactions(transactions);
                StorageManager.saveRecurring(recurringTxs);
                showToast("Transazioni ricorrenti aggiornate!");
            }
        }

        // --- CATEGORIE ---
        const categories = {
            expense: [
                { id: 'cibo', label: 'Cibo', icon: 'fa-solid fa-utensils', color: '#f87171' },
                { id: 'casa', label: 'Casa', icon: 'fa-solid fa-house', color: '#60a5fa' },
                { id: 'trasporti', label: 'Auto', icon: 'fa-solid fa-car', color: '#fbbf24' },
                { id: 'svago', label: 'Svago', icon: 'fa-solid fa-gamepad', color: '#a78bfa' },
                { id: 'salute', label: 'Salute', icon: 'fa-solid fa-heart-pulse', color: '#34d399' },
                { id: 'shopping', label: 'Shopping', icon: 'fa-solid fa-bag-shopping', color: '#f472b6' },
                { id: 'altro', label: 'Altro', icon: 'fa-solid fa-box', color: '#94a3b8' }
            ],
            income: [
                { id: 'stipendio', label: 'Stipendio', icon: 'fa-solid fa-money-bill-wave', color: '#10b981' },
                { id: 'regalo', label: 'Regalo', icon: 'fa-solid fa-gift', color: '#f59e0b' },
                { id: 'altro_in', label: 'Altro', icon: 'fa-solid fa-arrow-trend-up', color: '#6b7280' }
            ]
        };

        function handleSwipe() {
            const threshold = 50; // Distanza minima in pixel per considerare lo swipe valido
            if (touchEndX < touchStartX - threshold) {
                // Swipe a sinistra: vai al conto successivo
                switchAccountBySwipe(1);
            }
            if (touchEndX > touchStartX + threshold) {
                // Swipe a destra: vai al conto precedente
                switchAccountBySwipe(-1);
            }
        }

        function switchAccountBySwipe(direction) {
            if (accounts.length <= 1) return; // Se c'è solo un conto non fare nulla

            let currentIndex = accounts.findIndex(a => a.id === activeAccountId);
            currentIndex += direction;

            // Logica circolare (loop)
            if (currentIndex >= accounts.length) currentIndex = 0;
            if (currentIndex < 0) currentIndex = accounts.length - 1;

            activeAccountId = accounts[currentIndex].id;

            // Aggiungo un piccolo feedback visivo animato alla card
            dashCard.style.transform = direction > 0 ? 'translateX(-15px)' : 'translateX(15px)';
            dashCard.style.opacity = '0.5';

            setTimeout(() => {
                updateUI();
                dashCard.style.transform = 'translateX(0)';
                dashCard.style.opacity = '1';
            }, 150);
        }

        // --- MODAL TX ---
        function openModal(mode, tx = null) {
            currentMode = mode;
            editingTxId = tx ? tx.id : null;
            selectedCategory = tx ? tx.category : categories[mode][0].id;

            document.getElementById('modal-title').textContent = editingTxId ? (mode === 'income' ? 'Modifica Entrata' : 'Modifica Uscita') : (mode === 'income' ? 'Nuova Entrata' : 'Nuova Uscita');
            document.getElementById('delete-btn').classList.toggle('hidden', !editingTxId);

            // Aggiungi queste due righe dentro openModal(mode, tx = null):
            document.getElementById('is-recurring-checkbox').checked = false;
            document.getElementById('recurring-options').classList.add('hidden');
            // Nascondi tutto il container in modalità modifica per semplicità
            document.getElementById('recurring-container').classList.toggle('hidden', tx !== null);

            // --- APPLICAZIONE COLORI PASTELLO DINAMICI ---
            const isInc = mode === 'income';

            // Header e Footer
            document.getElementById('modal-header').className = `p-4 border-b flex justify-between items-center shrink-0 transition-colors ${isInc ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`;
            document.getElementById('modal-title').className = `text-lg font-bold ${isInc ? 'text-emerald-900' : 'text-rose-900'}`;
            document.getElementById('modal-close-btn').className = `w-8 h-8 flex items-center justify-center rounded-full transition-colors ${isInc ? 'text-emerald-600 hover:bg-emerald-200' : 'text-rose-600 hover:bg-rose-200'}`;
            document.getElementById('modal-footer').className = `p-4 border-t flex gap-3 shrink-0 transition-colors ${isInc ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`;

            // Box Importo
            document.getElementById('modal-amount-box').className = `relative rounded-xl p-4 border text-center transition-colors ${isInc ? 'bg-emerald-50 border-emerald-100' : 'bg-rose-50 border-rose-100'}`;
            document.getElementById('amount-input').className = `w-full text-4xl font-bold text-center bg-transparent border-none focus:ring-0 p-0 outline-none ${isInc ? 'text-emerald-900' : 'text-rose-900'}`;
            document.getElementById('modal-camera-btn').className = `w-10 h-10 flex items-center justify-center rounded-full active:scale-95 transition-all shadow-sm ${isInc ? 'text-emerald-600 bg-emerald-100 hover:bg-emerald-200' : 'text-rose-600 bg-rose-100 hover:bg-rose-200'}`;

            // Pulsante Salva
            document.getElementById('save-btn').className = `flex-1 py-3 text-white rounded-xl font-bold shadow-md transition-all active:scale-95 ${isInc ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-rose-500 hover:bg-rose-600'}`;

            const targetAccId = tx ? tx.accountId : activeAccountId;
            const targetAcc = accounts.find(a => a.id === targetAccId) || accounts[0];
            document.getElementById('modal-account-select').value = targetAcc.id;
            document.getElementById('selected-account-display').textContent = targetAcc.name;

            renderCategoryGrid();

            document.getElementById('amount-input').value = tx ? tx.amount : '';
            document.getElementById('desc-input').value = tx ? tx.description : '';
            document.getElementById('date-input').value = tx && tx.date ? tx.date.split('T')[0] : new Date().toISOString().split('T')[0];

            document.getElementById('modal').classList.remove('hidden');
            setTimeout(() => document.getElementById('amount-input').focus(), 50);
        }

        function renderCategoryGrid() {
            const grid = document.getElementById('category-grid');
            grid.innerHTML = categories[currentMode].map(c => `
                                <button onclick="selectCategory('${c.id}')" id="cat-${c.id}" class="cat-btn flex flex-col items-center justify-center p-3 border border-slate-200 rounded-xl bg-white shadow-sm outline-none">
                                    <i class="${c.icon} text-2xl" style="color: ${c.color}"></i>
                                    <span class="text-[10px] font-bold text-slate-600 mt-2 uppercase tracking-tight">${c.label}</span>
                                </button>`).join('');
            selectCategory(selectedCategory);
        }

        function selectCategory(id) {
            selectedCategory = id;
            document.querySelectorAll('.cat-btn').forEach(b => {
                b.classList.remove('selected-income', 'selected-expense');
            });
            const btn = document.getElementById('cat-' + id);
            if (btn) {
                btn.classList.add(currentMode === 'income' ? 'selected-income' : 'selected-expense');
            }
        }

        function closeModal() {
            document.getElementById('modal').classList.add('hidden');
            editingTxId = null;
        }

        function saveTransaction() {
            const amt = parseFloat(document.getElementById('amount-input').value);
            if (isNaN(amt) || amt <= 0) { showSimpleAlert("Attenzione", "Inserisci un importo valido."); return; }
            const desc = document.getElementById('desc-input').value.trim();
            const targetAccId = document.getElementById('modal-account-select').value;
            const selectedDate = document.getElementById('date-input').value;
            const isoDate = selectedDate ? new Date(selectedDate + 'T12:00:00').toISOString() : new Date().toISOString();

            // Controlla la ricorrenza
            const isRecurring = document.getElementById('is-recurring-checkbox').checked;
            const freq = document.getElementById('recurring-freq').value;

            if (editingTxId) {
                const idx = transactions.findIndex(t => t.id === editingTxId);
                transactions[idx] = { ...transactions[idx], amount: amt, description: desc, category: selectedCategory, accountId: targetAccId, date: isoDate };
            } else {
                const newId = Date.now();
                transactions.push({ id: newId, amount: amt, description: desc, category: selectedCategory, type: currentMode, accountId: targetAccId, date: isoDate });

                // Se è una nuova transazione e l'utente ha scelto "Ricorrente"
                if (isRecurring && selectedDate) {
                    recurringTxs.push({
                        id: 'rec_' + newId,
                        amount: amt,
                        description: desc,
                        category: selectedCategory,
                        type: currentMode,
                        accountId: targetAccId,
                        frequency: freq,
                        nextDate: getNextDate(selectedDate, freq) // La prossima scatterà tra 1 mese/settimana
                    });
                    StorageManager.saveRecurring(recurringTxs);
                }
            }
            StorageManager.saveTransactions(transactions);
            activeAccountId = targetAccId;
            updateUI(); closeModal();
        }

        function editTransaction(id) { const tx = transactions.find(t => t.id === id); if (tx) openModal(tx.type, tx); }

        function deleteTx(id) {
            txToDeleteId = id;
            document.getElementById('delete-tx-modal').classList.remove('hidden');
        }

        function closeDeleteTxModal() { document.getElementById('delete-tx-modal').classList.add('hidden'); txToDeleteId = null; }

        function confirmDeleteTx() {
            if (!txToDeleteId) return;

            const txToDelete = transactions.find(t => t.id === txToDeleteId);

            // Se la transazione è legata a un'altra (es. un Giroconto), eliminiamo entrambe
            if (txToDelete && txToDelete.linkedId) {
                transactions = transactions.filter(t => t.id !== txToDeleteId && t.id !== txToDelete.linkedId);
            } else {
                // Eliminazione standard
                transactions = transactions.filter(t => t.id !== txToDeleteId);
            }

            StorageManager.saveTransactions(transactions);
            updateUI();
            closeDeleteTxModal();
            closeModal();
            showToast("Movimento eliminato");
        }

        // --- GEMINI AI ---
        function openApiKeyModal() {
            document.getElementById('modal-api-key').value = apiKey;
            document.getElementById('api-key-modal').classList.remove('hidden');
        }

        function closeApiKeyModal() { document.getElementById('api-key-modal').classList.add('hidden'); }

        function saveApiKey() {
            const key = document.getElementById('modal-api-key').value.trim();

            if (key) {
                apiKey = key;
                StorageManager.saveApiKey(key); // Sostituzione qui!
                showToast("API Key salvata!");
            } else {
                apiKey = "";
                StorageManager.removeApiKey(); // Sostituzione qui!
                showToast("API Key rimossa");
            }

            closeApiKeyModal();
        }

        function triggerCamera() {
            if (!apiKey) { openApiKeyModal(); return; }
            document.getElementById('camera-input').click();
        }

        async function handleImage(event) {
            const file = event.target.files[0];
            if (!file || !apiKey) return;

            const loader = document.getElementById('camera-loader');
            loader.classList.remove('hidden');

            try {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = async () => {
                    try {
                        const b64 = reader.result.split(',')[1];

                        // Chiamata all'API migliorata
                        const result = await analyzeReceipt(b64);

                        // Popoliamo i campi della UI
                        if (result) {
                            if (result.amount) document.getElementById('amount-input').value = result.amount;
                            if (result.description) document.getElementById('desc-input').value = result.description;

                            // Imposta la data se trovata
                            if (result.date) {
                                document.getElementById('date-input').value = result.date;
                            }

                            // Imposta la categoria evidenziando il pulsante corretto
                            if (result.categoryId) {
                                // Verifichiamo che l'ID restituito esista davvero
                                const catExists = categories.expense.some(c => c.id === result.categoryId);
                                if (catExists) {
                                    selectCategory(result.categoryId);
                                }
                            }
                        }
                        showToast("Scontrino scansionato con successo!");

                    } catch (apiError) {
                        showSimpleAlert("Errore Scansione", apiError.message);
                    } finally {
                        loader.classList.add('hidden');
                        document.getElementById('camera-input').value = '';
                    }
                };
            } catch (err) {
                showSimpleAlert("Errore", err.message);
                loader.classList.add('hidden');
            }
        }

        async function analyzeReceipt(base64) {
            // 1. Creiamo una stringa con le categorie disponibili per istruire il modello
            const categoryList = categories.expense.map(c => `'${c.id}' (${c.label})`).join(', ');

            const prompt = `Analizza questo scontrino. Estrai il totale, il nome del negozio, la data e assegna una categoria.
                    Devi scegliere ESATTAMENTE uno di questi ID categoria: [${categoryList}]. Se non sei sicuro, usa 'altro'.`;

            // 2. Definiamo lo schema JSON esatto (Structured Output)
            const schema = {
                type: "OBJECT",
                properties: {
                    amount: {
                        type: "NUMBER",
                        description: "Il totale finale da pagare sullo scontrino (usa il punto per i decimali)."
                    },
                    description: {
                        type: "STRING",
                        description: "Il nome del negozio o brand."
                    },
                    date: {
                        type: "STRING",
                        description: "La data dello scontrino nel formato esatto YYYY-MM-DD. Se non c'è, usa la data di oggi."
                    },
                    categoryId: {
                        type: "STRING",
                        description: "L'ID della categoria più appropriata tra quelle fornite."
                    }
                },
                required: ["amount", "description", "date", "categoryId"]
            };

            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: prompt },
                            { inlineData: { mimeType: "image/jpeg", data: base64 } }
                        ]
                    }],
                    generationConfig: {
                        responseMimeType: "application/json",
                        responseSchema: schema // <-- Passiamo lo schema a Gemini!
                    }
                })
            });

            const data = await response.json();
            if (data.error) throw new Error(data.error.message);
            if (!data.candidates || data.candidates.length === 0) throw new Error("Lettura fallita o scontrino illeggibile.");

            try {
                return JSON.parse(data.candidates[0].content.parts[0].text);
            } catch {
                throw new Error("Errore nel parse dei dati di Gemini.");
            }
        }

        // --- RESET DATI ---
        function openResetModal() { document.getElementById('reset-data-modal').classList.remove('hidden'); }
        function closeResetModal() { document.getElementById('reset-data-modal').classList.add('hidden'); }
        function confirmResetData() {
            StorageManager.clearAll();
            showToast("Reset completato. Riavvio...");
            setTimeout(() => location.reload(), 1000);
        }

        window.onload = () => {
            processRecurringTransactions(); // Processa eventuali abbonamenti scaduti
            updateUI(); // Renderizza l'interfaccia
        };

        // ==========================================
        // SERVICE WORKER REGISTRATION
        // ==========================================
        if ('serviceWorker' in navigator) {
            // Aspettiamo che la pagina sia caricata prima di registrare il SW
            window.addEventListener('load', () => {
                // Registriamo il file sw.js che si trova nella stessa cartella
                navigator.serviceWorker.register('sw.js')
                    .then(registration => {
                        console.log('✅ ServiceWorker registrato con successo! Scope:', registration.scope);
                    })
                    .catch(error => {
                        console.log('❌ Registrazione ServiceWorker fallita:', error);
                    });
            });
        }