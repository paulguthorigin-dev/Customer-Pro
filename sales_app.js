// Customer Pro Prototyp - Frontend JavaScript
const API_BASE_URL = 'http://localhost:5001/api';

// Globale Variablen
let currentUser = null;
let currentCustomerId = null;
let currentConstructionSiteId = null;
let currentTourStops = [];

// Upload-Lock Variablen
let uploadInProgressCustomer = false;
let uploadInProgressSite = false;
let uploadedFilesCustomer = new Set();
let uploadedFilesSite = new Set();

// Innendienst View-Modus (Nur-Lesen)
let isInnendienstViewMode = false;
let selectedAussendienstUserId = null;
let cachedInnendienstData = null;

// ===================================================
// MOBILE NAVIGATION
// ===================================================

function toggleMobileSidebar() {
    const sidebar = document.getElementById('main-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    
    if (!sidebar || !overlay) return;
    
    if (sidebar.classList.contains('open')) {
        closeMobileSidebar();
    } else {
        sidebar.classList.add('open');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden'; // Verhindern von Scroll im Hintergrund
    }
}

function closeMobileSidebar() {
    const sidebar = document.getElementById('main-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    
    if (!sidebar || !overlay) return;
    
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
    document.body.style.overflow = ''; // Scroll wieder aktivieren
}

// Sidebar schließen wenn ein Menüpunkt geklickt wird (nur auf Mobile)
function closeSidebarOnMobile() {
    if (window.innerWidth <= 768) {
        closeMobileSidebar();
    }
}

// ===================================================
// AUTH & SESSION
// ===================================================

async function login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (!username || !password) {
        showMessage('Bitte alle Felder ausfüllen', 'warning');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (data.success) {
            currentUser = data.user;
            // Token im localStorage speichern für file:// Zugriff
            localStorage.setItem('auth_user_id', data.user.id);
            localStorage.setItem('auth_username', data.user.username);
            localStorage.setItem('auth_user', JSON.stringify(data.user));
            console.log('[LOGIN] Erfolgreich:', currentUser.username, 'Rolle:', currentUser.role);
            showMessage(`Willkommen, ${data.user.username}!`, 'success');
            initApp();
        } else {
            showMessage(data.message || 'Login fehlgeschlagen', 'error');
        }
    } catch (error) {
        console.error('Login-Fehler:', error);
        showMessage('Verbindung zum Server fehlgeschlagen', 'error');
    }
}

// Helper-Funktion für authentifizierte Requests
function getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const userId = localStorage.getItem('auth_user_id');
    const username = localStorage.getItem('auth_username');
    if (userId && username) {
        headers['X-User-ID'] = userId;
        headers['X-Username'] = username;
    }
    return headers;
}

async function logout() {
    try {
        closeSidebarOnMobile(); // Sidebar schließen falls offen
        await fetch(`${API_BASE_URL}/auth/logout`, {
            method: 'POST',
            credentials: 'include'
        });
        currentUser = null;
        localStorage.removeItem('auth_user_id');
        localStorage.removeItem('auth_username');
        localStorage.removeItem('auth_user');
        document.getElementById('main-app').style.display = 'none';
        document.getElementById('login-screen').style.display = 'flex';
        showMessage('Erfolgreich abgemeldet', 'success');
    } catch (error) {
        console.error('Logout-Fehler:', error);
    }
}

async function checkAuth() {
    try {
        const response = await fetch(`${API_BASE_URL}/auth/check`, {
            credentials: 'include'
        });
        const data = await response.json();
        if (data.authenticated) {
            currentUser = data.user;
            console.log('[AUTH] Bereits angemeldet:', currentUser.username);
            initApp();
        }
    } catch (error) {
        console.log('[AUTH] Nicht angemeldet');
    }
}

// ===================================================
// APP INITIALIZATION
// ===================================================

function initApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'flex';
    
    document.getElementById('user-display-name').textContent = currentUser.username;
    document.getElementById('user-display-role').textContent = currentUser.role;
    
    buildNavigation();
    
    if (currentUser.role === 'Innendienst') {
        showContent('innendienst');
    } else {
        showContent('customer');
    }
}

function buildNavigation() {
    const nav = document.getElementById('main-navigation');
    let navHTML = '';

    if (currentUser.role === 'Außendienst' || currentUser.is_admin) {
        navHTML += `
            <a class="nav-item" data-section="customer"><i class="fas fa-users"></i> Kunden</a>
            <a class="nav-item" data-section="construction"><i class="fas fa-hard-hat"></i> Baustellen</a>
            <a class="nav-item" data-section="tour"><i class="fas fa-route"></i> Tourenplan</a>
            <a class="nav-item" data-section="archive"><i class="fas fa-archive"></i> Touren-Archiv</a>
        `;
    }

    if (currentUser.role === 'Innendienst') {
        navHTML += `<a class="nav-item" data-section="innendienst"><i class="fas fa-desktop"></i> Dashboard</a>`;
    }

    if (currentUser.is_admin) {
        navHTML += `<a class="nav-item" data-section="admin"><i class="fas fa-cogs"></i> Admin</a>`;
    }

    nav.innerHTML = navHTML;
    nav.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            showContent(item.dataset.section);
            closeSidebarOnMobile(); // Sidebar auf Mobile schließen
        });
    });
}

function showContent(section) {
    uploadedFilesCustomer.clear();
    uploadedFilesSite.clear();
    
    // SICHERHEITSPRÜFUNG: Nur Innendienst-Benutzer dürfen zur Innendienst-Section
    if (section === 'innendienst') {
        if (!currentUser || currentUser.role !== 'Innendienst') {
            console.warn('[SECURITY] Nicht-Innendienst-Benutzer versuchte auf Innendienst-Dashboard zuzugreifen!');
            // Umleitung zur korrekten Startseite
            section = 'customer';
        }
        isInnendienstViewMode = false;
    }
    
    document.querySelectorAll('.content-section').forEach(sec => sec.style.display = 'none');
    const targetSection = document.getElementById(section + '-section');
    if (targetSection) targetSection.style.display = 'block';
    
    document.querySelectorAll('.nav-item').forEach(a => a.classList.remove('active'));
    const activeNav = document.querySelector(`[data-section="${section}"]`);
    if(activeNav) activeNav.classList.add('active');
    
    if (section === 'customer') loadCustomers();
    else if (section === 'construction') loadAllConstructionSites();
    else if (section === 'tour') loadTours();
    else if (section === 'archive') loadArchivedTours();
    else if (section === 'admin') loadUsers();
    else if (section === 'innendienst') loadInnendienstUsers();
}

// ===================================================
// TAB-MANAGEMENT (KORRIGIERT)
// ===================================================

function switchTab(tabName) {
    // Alle Tab-Buttons deaktivieren
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    // Alle Tab-Contents ausblenden
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // Geklickten Tab aktivieren
    event.target.classList.add('active');
    
    // Zugehörigen Content anzeigen
    const tabContent = document.getElementById('tab-' + tabName);
    if (tabContent) {
        tabContent.classList.add('active');
    }
}

// ===================================================
// KUNDEN-MANAGEMENT
// ===================================================

async function loadCustomers() {
    const container = document.getElementById('customer-list-container');
    container.innerHTML = '<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-3xl text-blue-500"></i></div>';

    try {
        const response = await fetch(`${API_BASE_URL}/customers`, {
            headers: getAuthHeaders(),
            credentials: 'include'
        });
        
        if (!response.ok) {
            container.innerHTML = '<div class="text-center py-12 text-gray-500">Keine Kunden vorhanden</div>';
            return;
        }
        
        const customers = await response.json();
        console.log('[CUSTOMERS] Geladen:', customers.length, 'Kunden');
        
        if (!customers || customers.length === 0) {
            container.innerHTML = '<div class="text-center py-12 text-gray-500">Keine Kunden vorhanden. Klicken Sie auf "Neuer Kunde" um zu beginnen.</div>';
            return;
        }

        container.innerHTML = customers.map(c => `
            <div class="customer-card" onclick="showCustomerDetail(${c.id})">
                <div class="flex-grow">
                    <div class="font-bold text-xl text-gray-900">${c.name}</div>
                    <div class="text-sm text-gray-500 mt-1"><i class="fas fa-hashtag mr-1"></i>${c.customer_number}</div>
                    <div class="text-sm text-gray-600 mt-1"><i class="fas fa-map-marker-alt mr-1"></i>${c.address || 'Keine Adresse'}</div>
                </div>
                <i class="fas fa-chevron-right text-gray-400"></i>
            </div>
        `).join('');
        
        updateCustomerDatalist(customers);
    } catch (error) {
        console.error('Fehler beim Laden der Kunden:', error);
        container.innerHTML = '<div class="text-center py-12 text-gray-500">Keine Kunden vorhanden</div>';
    }
}

function updateCustomerDatalist(customers) {
    let datalist = document.getElementById('customerDatalist');
    if (!datalist) {
        datalist = document.createElement('datalist');
        datalist.id = 'customerDatalist';
        document.body.appendChild(datalist);
    }
    datalist.innerHTML = customers.map(c => 
        `<option value="${c.name}" data-address="${c.address || ''}">`
    ).join('');
}

async function showCustomerDetail(customerId) {
    currentCustomerId = customerId;
    uploadedFilesCustomer.clear();
    
    try {
        const response = await fetch(`${API_BASE_URL}/customers/${customerId}`, {
                    headers: getAuthHeaders(),  // <--- Diese Zeile ist neu und wichtig!
                    credentials: 'include'
                });
        
        if (response.status === 403) {
            console.log('[CUSTOMER] Keine Berechtigung');
            showContent('customer');
            return;
        }
        
        if (!response.ok) {
            console.log('[CUSTOMER] Fehler beim Laden');
            showContent('customer');
            return;
        }
        
        const customer = await response.json();
        
        document.getElementById('detail-customer-name').textContent = customer.name;
        document.getElementById('detail-customer-number').textContent = customer.customer_number;
        document.getElementById('detail-customer-address').textContent = customer.address || '-';
        document.getElementById('detail-customer-phone').textContent = customer.phone || '-';
        document.getElementById('detail-customer-email').textContent = customer.email || '-';
        
        if (customer.address) {
            document.getElementById('detail-customer-address-link').href = 
                `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(customer.address)}`;
        }
        
        renderProtocols(customer.protocols || []);
        renderDocuments(customer.documents || []);
        renderConstructionSites(customer.construction_sites || []);
        
        setupCustomerFileUpload();
        
        // Tabs zurücksetzen
        document.querySelectorAll('.tab-button').forEach((btn, idx) => {
            btn.classList.toggle('active', idx === 0);
        });
        document.querySelectorAll('.tab-content').forEach((content, idx) => {
            content.classList.toggle('active', idx === 0);
        });
        
        // Innendienst-Modus: Bearbeitungsbuttons ausblenden
        updateCustomerDetailButtons();
        
        document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
        document.getElementById('customer-detail-section').style.display = 'block';
    } catch (error) {
        console.error('Fehler beim Laden:', error);
        showContent('customer');
    }
}

// Funktion zum Aktualisieren der Buttons basierend auf dem Modus
function updateCustomerDetailButtons() {
    const editBtn = document.querySelector('#customer-detail-section button[onclick="editCustomerFromDetail()"]');
    const deleteBtn = document.querySelector('#customer-detail-section button[onclick="deleteCustomerFromDetail()"]');
    const protocolBtn = document.querySelector('#customer-detail-section button[onclick="openProtocolModal()"]');
    const documentBtn = document.querySelector('#customer-detail-section button[onclick="openDocumentModal()"]');
    const siteBtn = document.querySelector('#customer-detail-section button[onclick="openConstructionSiteModal()"]');
    const dropZone = document.getElementById('customer-drop-zone');
    const backBtn = document.querySelector('#customer-detail-section button[onclick*="showContent"], #customer-detail-section button[onclick*="goBackSafe"]');
    
    if (isInnendienstViewMode) {
        // Verstecke alle Bearbeitungsbuttons
        if (editBtn) editBtn.style.display = 'none';
        if (deleteBtn) deleteBtn.style.display = 'none';
        if (protocolBtn) protocolBtn.style.display = 'none';
        if (documentBtn) documentBtn.style.display = 'none';
        if (siteBtn) siteBtn.style.display = 'none';
        if (dropZone) dropZone.style.display = 'none';
        // FIX: Sichere Zurück-Navigation verwenden
        if (backBtn) backBtn.setAttribute('onclick', 'goBackSafeFromCustomer()');
    } else {
        // Zeige alle Bearbeitungsbuttons
        if (editBtn) editBtn.style.display = '';
        if (deleteBtn) deleteBtn.style.display = '';
        if (protocolBtn) protocolBtn.style.display = '';
        if (documentBtn) documentBtn.style.display = '';
        if (siteBtn) siteBtn.style.display = '';
        if (dropZone) dropZone.style.display = '';
        // FIX: Sichere Zurück-Navigation verwenden
        if (backBtn) backBtn.setAttribute('onclick', 'goBackSafeFromCustomer()');
    }
}

// FIX: Sichere Zurück-Navigation, die die Benutzerrolle prüft
function goBackSafeFromCustomer() {
    // SICHERHEITSPRÜFUNG: Nur Innendienst-Benutzer dürfen zum Innendienst-Dashboard
    if (isInnendienstViewMode && currentUser && currentUser.role === 'Innendienst') {
        isInnendienstViewMode = false;
        showContent('innendienst');
        // Daten erneut laden, falls ein Außendienst ausgewählt war
        if (selectedAussendienstUserId) {
            document.getElementById('innendienst-user-select').value = selectedAussendienstUserId;
            loadInnendienstData();
        }
    } else {
        // Außendienst-Benutzer gehen zur Kundenliste zurück
        isInnendienstViewMode = false;
        showContent('customer');
    }
}

// Zurück zum Innendienst-Dashboard (mit Sicherheitsprüfung)
function goBackToInnendienstDashboard() {
    // SICHERHEITSPRÜFUNG: Nur Innendienst-Benutzer dürfen zum Innendienst-Dashboard
    if (currentUser && currentUser.role !== 'Innendienst') {
        console.warn('[SECURITY] Außendienst-Benutzer versuchte auf Innendienst-Dashboard zuzugreifen!');
        isInnendienstViewMode = false;
        showContent('customer');
        return;
    }
    
    isInnendienstViewMode = false;
    showContent('innendienst');
    // Daten erneut laden, falls ein Außendienst ausgewählt war
    if (selectedAussendienstUserId) {
        document.getElementById('innendienst-user-select').value = selectedAussendienstUserId;
        loadInnendienstData();
    }
}

function openCustomerModal(customer = null) {
    const modal = document.getElementById('customerModal');
    modal.innerHTML = `
        <div class="modal-content">
            <h2 class="text-2xl font-bold mb-6">${customer ? 'Kunde bearbeiten' : 'Neuer Kunde'}</h2>
            <div class="space-y-4">
                <input type="hidden" id="edit-customer-id" value="${customer ? customer.id : ''}">
                <div><label>Kundennummer *</label><input type="text" id="customer-number" value="${customer ? customer.customer_number : ''}"></div>
                <div><label>Firmenname *</label><input type="text" id="customer-name" value="${customer ? customer.name : ''}"></div>
                <div><label>Adresse</label><input type="text" id="customer-address" value="${customer ? customer.address || '' : ''}"></div>
                <div><label>Telefon</label><input type="tel" id="customer-phone" value="${customer ? customer.phone || '' : ''}"></div>
                <div><label>E-Mail</label><input type="email" id="customer-email" value="${customer ? customer.email || '' : ''}"></div>
            </div>
            <div class="flex justify-end gap-3 mt-6">
                <button class="secondary-button" onclick="closeModal('customerModal')">Abbrechen</button>
                <button class="action-button" onclick="saveCustomer()">Speichern</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

async function saveCustomer() {
    const id = document.getElementById('edit-customer-id').value;
    const data = {
        customer_number: document.getElementById('customer-number').value.trim(),
        name: document.getElementById('customer-name').value.trim(),
        address: document.getElementById('customer-address').value.trim(),
        phone: document.getElementById('customer-phone').value.trim(),
        email: document.getElementById('customer-email').value.trim()
    };

    if (!data.customer_number || !data.name) {
        showMessage('Kundennummer und Name erforderlich!', 'warning');
        return;
    }

    try {
        const url = id ? `${API_BASE_URL}/customers/${id}` : `${API_BASE_URL}/customers`;
        console.log('[SAVE] Speichere Kunde:', url, data);
        
        const response = await fetch(url, {
            method: id ? 'PUT' : 'POST',
            headers: getAuthHeaders(),
            credentials: 'include',
            body: JSON.stringify(data)
        });

        console.log('[SAVE] Response Status:', response.status);

        if (response.ok) {
            showMessage(id ? 'Kunde aktualisiert!' : 'Kunde erstellt!', 'success');
            closeModal('customerModal');
            loadCustomers();
        } else if (response.status === 401) {
            showMessage('Sitzung abgelaufen - bitte neu anmelden', 'warning');
            setTimeout(() => location.reload(), 1500);
        } else {
            const errorData = await response.json().catch(() => ({}));
            showMessage(errorData.message || 'Fehler beim Speichern', 'warning');
        }
    } catch (error) {
        console.error('[SAVE] Netzwerkfehler:', error);
        showMessage('Verbindungsfehler - Server erreichbar?', 'warning');
    }
}

function editCustomerFromDetail() {
    fetch(`${API_BASE_URL}/customers/${currentCustomerId}`, { headers: getAuthHeaders(), credentials: 'include' })
        .then(r => r.json())
        .then(c => openCustomerModal(c));
}

async function deleteCustomerFromDetail() {
    if (!(await confirmAction('Kunde wirklich löschen? Alle zugehörigen Daten werden gelöscht.'))) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/customers/${currentCustomerId}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (response.ok) {
            showMessage('Kunde gelöscht', 'success');
            showContent('customer');
        } else {
            showContent('customer');
        }
    } catch (error) {
        showContent('customer');
    }
}

// ===================================================
// BESUCHSPROTOKOLLE
// ===================================================

function renderProtocols(protocols) {
    const container = document.getElementById('protocols-list');
    if (!protocols || protocols.length === 0) {
        container.innerHTML = '<div class="text-center py-8 text-gray-500">Keine Besuche dokumentiert</div>';
        return;
    }
    
    container.innerHTML = protocols.map(p => {
        const daysAgo = Math.floor((new Date() - new Date(p.visit_date)) / (1000 * 60 * 60 * 24));
        return `
            <div class="card">
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <span class="text-sm font-semibold text-blue-600"><i class="fas fa-calendar mr-2"></i>${p.visit_date}</span>
                        <span class="text-xs text-gray-500 ml-3">(vor ${daysAgo} Tagen)</span>
                    </div>
                    ${!isInnendienstViewMode ? `<button onclick="deleteProtocol(${p.id})" class="icon-button text-red-500"><i class="fas fa-trash"></i></button>` : ''}
                </div>
                <p class="text-gray-700">${p.summary}</p>
            </div>
        `;
    }).join('');
}

function openProtocolModal() {
    const modal = document.getElementById('protocolModal');
    modal.innerHTML = `
        <div class="modal-content">
            <h2 class="text-2xl font-bold mb-6">Neues Besuchsprotokoll</h2>
            <div class="space-y-4">
                <div><label>Besuchsdatum *</label><input type="date" id="protocol-date" value="${new Date().toISOString().split('T')[0]}"></div>
                <div><label>Zusammenfassung *</label><textarea id="protocol-summary" rows="6" placeholder="Gesprächsnotizen, Ergebnisse, nächste Schritte..."></textarea></div>
            </div>
            <div class="flex justify-end gap-3 mt-6">
                <button class="secondary-button" onclick="closeModal('protocolModal')">Abbrechen</button>
                <button class="action-button" onclick="saveProtocol()">Speichern</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
}

async function saveProtocol() {
    const data = {
        customer_id: currentCustomerId,
        visit_date: document.getElementById('protocol-date').value,
        summary: document.getElementById('protocol-summary').value.trim()
    };
    
    if (!data.visit_date || !data.summary) {
        showMessage('Alle Felder ausfüllen!', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/protocols`, {
            method: 'POST',
            headers: getAuthHeaders(),  // FIX: Auth Headers verwenden
            credentials: 'include',
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            showMessage('Protokoll gespeichert!', 'success');
            closeModal('protocolModal');
            showCustomerDetail(currentCustomerId);
        } else if (response.status === 401) {
            showMessage('Sitzung abgelaufen - bitte neu anmelden', 'warning');
        } else {
            const errorData = await response.json().catch(() => ({}));
            showMessage(errorData.message || 'Fehler beim Speichern', 'error');
        }
    } catch (error) {
        console.error('Fehler:', error);
        showMessage('Verbindungsfehler', 'error');
    }
}

async function deleteProtocol(id) {
    if (!(await confirmAction('Protokoll löschen?'))) return;
    await fetch(`${API_BASE_URL}/protocols/${id}`, { method: 'DELETE', headers: getAuthHeaders(), credentials: 'include' });
    showMessage('Protokoll gelöscht', 'success');
    showCustomerDetail(currentCustomerId);
}

// ===================================================
// DOKUMENTEN-MANAGEMENT
// ===================================================

function renderDocuments(documents) {
    const container = document.getElementById('documents-list');
    if (!documents || documents.length === 0) {
        container.innerHTML = '<div class="text-center py-8 text-gray-500">Keine Dokumente vorhanden</div>';
        return;
    }
    
    container.innerHTML = documents.map(doc => `
        <div class="card">
            <div class="flex justify-between items-start">
                <div class="flex-grow">
                    <div class="font-semibold">${doc.name}</div>
                    <div class="text-sm text-gray-500 mt-1">
                        <span class="inline-block px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs mr-2">${doc.type}</span>
                        ${doc.created_at}
                    </div>
                </div>
                <div class="flex space-x-2">
                    ${doc.file_url ? `<a href="${doc.file_url}" target="_blank" class="icon-button text-blue-600"><i class="fas fa-external-link-alt"></i></a>` : ''}
                    ${doc.has_file ? `<button onclick="downloadDocument(${doc.id})" class="icon-button text-green-600"><i class="fas fa-download"></i></button>` : ''}
                    ${!isInnendienstViewMode ? `<button onclick="deleteDocument(${doc.id})" class="icon-button text-red-500"><i class="fas fa-trash"></i></button>` : ''}
                </div>
            </div>
        </div>
    `).join('');
}

function setupCustomerFileUpload() {
    const dropZone = document.getElementById('customer-drop-zone');
    const fileInput = document.getElementById('customer-file-input');
    
    if (!dropZone || !fileInput) return;
    
    // Event-Listener durch Klonen entfernen
    const newDropZone = dropZone.cloneNode(true);
    dropZone.parentNode.replaceChild(newDropZone, dropZone);
    
    const newFileInput = document.getElementById('customer-file-input');
    
    newDropZone.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        newFileInput.click();
    };
    
    newDropZone.ondragover = function(e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.add('dragover');
    };
    
    newDropZone.ondragleave = function(e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove('dragover');
    };
    
    newDropZone.ondrop = function(e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleCustomerFilesSequential(Array.from(files));
        }
    };
    
    newFileInput.onchange = function(e) {
        const files = e.target.files;
        if (files.length > 0) {
            handleCustomerFilesSequential(Array.from(files));
        }
        this.value = '';
    };
}

async function handleCustomerFilesSequential(files) {
    if (uploadInProgressCustomer) {
        console.log('[UPLOAD] Bereits in Bearbeitung');
        return;
    }
    
    uploadInProgressCustomer = true;
    console.log(`[UPLOAD] Starte Upload von ${files.length} Datei(en)`);
    
    for (const file of files) {
        const fileKey = `${file.name}_${file.size}_${file.lastModified}`;
        if (uploadedFilesCustomer.has(fileKey)) {
            console.log(`[UPLOAD] Überspringe Duplikat: ${file.name}`);
            continue;
        }
        
        uploadedFilesCustomer.add(fileKey);
        
        try {
            await uploadSingleFile(file, currentCustomerId, null);
            showMessage(`${file.name} hochgeladen!`, 'success');
        } catch (error) {
            console.error(`[UPLOAD] Fehler bei ${file.name}:`, error);
        }
    }
    
    uploadInProgressCustomer = false;
    showCustomerDetail(currentCustomerId);
}

function uploadSingleFile(file, customerId, siteId) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = async function(e) {
            const fileName = file.name.toLowerCase();
            let fileType = 'Sonstiges';
            
            if (file.type.includes('pdf') || fileName.endsWith('.pdf')) {
                fileType = 'PDF';
            } else if (file.type.includes('image') || fileName.match(/\.(jpg|jpeg|png|gif|bmp|webp)$/)) {
                fileType = 'Bild';
            }
            
            const data = {
                customer_id: customerId,
                construction_site_id: siteId,
                name: file.name,
                type: fileType,
                file_url: '',
                file_data: e.target.result
            };
            
            try {
                const response = await fetch(`${API_BASE_URL}/documents`, {
                    method: 'POST',
                    headers: getAuthHeaders(),  // FIX: Auth Headers verwenden
                    credentials: 'include',
                    body: JSON.stringify(data)
                });
                
                if (response.ok) {
                    console.log(`[UPLOAD] Erfolgreich: ${file.name}`);
                    resolve();
                } else {
                    const error = await response.json();
                    reject(new Error(error.message));
                }
            } catch (error) {
                reject(error);
            }
        };
        
        reader.onerror = function() {
            reject(new Error('Datei konnte nicht gelesen werden'));
        };
        
        reader.readAsDataURL(file);
    });
}

function openDocumentModal() {
    const modal = document.getElementById('documentModal');
    modal.innerHTML = `
        <div class="modal-content">
            <h2 class="text-2xl font-bold mb-6">Neues Dokument (Link)</h2>
            <div class="space-y-4">
                <div><label>Name *</label><input type="text" id="document-name" placeholder="z.B. Angebot 2025"></div>
                <div><label>Typ *</label>
                    <select id="document-type">
                        <option value="PDF">PDF</option>
                        <option value="E-Mail">E-Mail</option>
                        <option value="Angebot">Angebot</option>
                        <option value="Vertrag">Vertrag</option>
                        <option value="Sonstiges">Sonstiges</option>
                    </select>
                </div>
                <div><label>Link/URL</label><input type="text" id="document-url" placeholder="https://..."></div>
            </div>
            <div class="flex justify-end gap-3 mt-6">
                <button class="secondary-button" onclick="closeModal('documentModal')">Abbrechen</button>
                <button class="action-button" onclick="saveDocument()">Speichern</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
}

async function saveDocument() {
    const data = {
        customer_id: currentCustomerId,
        name: document.getElementById('document-name').value.trim(),
        type: document.getElementById('document-type').value,
        file_url: document.getElementById('document-url').value.trim()
    };
    
    if (!data.name) {
        showMessage('Name erforderlich!', 'warning');
        return;
    }
    
    const response = await fetch(`${API_BASE_URL}/documents`, {
        method: 'POST',
        headers: getAuthHeaders(),  // FIX: Auth Headers verwenden
        credentials: 'include',
        body: JSON.stringify(data)
    });
    
    if (response.ok) {
        showMessage('Dokument gespeichert!', 'success');
        closeModal('documentModal');
        showCustomerDetail(currentCustomerId);
    } else if (response.status === 401) {
        showMessage('Sitzung abgelaufen - bitte neu anmelden', 'warning');
    } else {
        showMessage('Fehler beim Speichern', 'error');
    }
}

async function deleteDocument(id) {
    if (!(await confirmAction('Dokument löschen?'))) return;
    await fetch(`${API_BASE_URL}/documents/${id}`, { method: 'DELETE', headers: getAuthHeaders(), credentials: 'include' });
    showMessage('Dokument gelöscht', 'success');
    if (currentCustomerId) showCustomerDetail(currentCustomerId);
    if (currentConstructionSiteId) showConstructionSiteDetail(currentConstructionSiteId);
}

async function downloadDocument(id) {
    try {
        const response = await fetch(`${API_BASE_URL}/documents/${id}/download`, { headers: getAuthHeaders(), credentials: 'include' });
        if (!response.ok) return;
        const data = await response.json();
        const link = document.createElement('a');
        link.href = `data:application/octet-stream;base64,${data.data}`;
        link.download = data.name;
        link.click();
    } catch (error) {
        console.error('Download fehlgeschlagen:', error);
    }
}

// ===================================================
// BAUSTELLEN-MANAGEMENT
// ===================================================

function renderConstructionSites(sites) {
    const container = document.getElementById('construction-sites-list');
    if (!sites || sites.length === 0) {
        container.innerHTML = '<div class="text-center py-8 text-gray-500">Keine Baustellen vorhanden</div>';
        return;
    }
    
    container.innerHTML = sites.map(site => `
        <div class="site-card" onclick="showConstructionSiteDetail(${site.id})">
            <div class="flex-grow">
                <div class="font-bold text-xl">${site.name}</div>
                <div class="text-sm text-gray-600 mt-1"><i class="fas fa-map-marker-alt mr-1"></i>${site.address}</div>
                <div class="mt-2"><span class="status-badge status-${site.status.toLowerCase()}">${site.status}</span></div>
            </div>
            <i class="fas fa-chevron-right text-gray-400"></i>
        </div>
    `).join('');
}

async function loadAllConstructionSites() {
    const container = document.getElementById('all-construction-sites-container');
    container.innerHTML = '<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-3xl text-blue-500"></i></div>';

    try {
        const response = await fetch(`${API_BASE_URL}/constructionsites`, {
            headers: getAuthHeaders(),
            credentials: 'include'
        });
        const sites = await response.json();
        
        console.log('[SITES] Geladen:', sites.length, 'Baustellen');
        
        if (!sites || sites.length === 0) {
            container.innerHTML = '<div class="text-center py-12 text-gray-500">Keine Baustellen vorhanden. Erstellen Sie eine Baustelle über einen Kunden.</div>';
            return;
        }

        container.innerHTML = sites.map(site => `
            <div class="site-card" onclick="showConstructionSiteDetail(${site.id})">
                <div class="flex-grow">
                    <div class="font-bold text-xl">${site.name}</div>
                    <div class="text-sm text-gray-600 mt-1"><i class="fas fa-map-marker-alt mr-1"></i>${site.address}</div>
                    <div class="mt-2"><span class="status-badge status-${site.status.toLowerCase()}">${site.status}</span></div>
                    ${site.start_date ? `<div class="text-xs text-gray-500 mt-2">Start: ${site.start_date}</div>` : ''}
                </div>
                <i class="fas fa-chevron-right text-gray-400"></i>
            </div>
        `).join('');
    } catch (error) {
        console.error('Fehler beim Laden der Baustellen:', error);
        container.innerHTML = '<div class="text-center py-12 text-gray-500">Keine Baustellen vorhanden</div>';
    }
}

async function showConstructionSiteDetail(siteId) {
    currentConstructionSiteId = siteId;
    uploadedFilesSite.clear();
    
    try {
            const response = await fetch(`${API_BASE_URL}/constructionsites/${siteId}`, {
                headers: getAuthHeaders(),  // <--- Auch hier einfügen!
                credentials: 'include'
            });
        
        if (response.status === 403) {
            console.log('[SITE] Keine Berechtigung');
            showContent('construction');
            return;
        }
        
        if (!response.ok) {
            console.log('[SITE] Fehler beim Laden');
            showContent('construction');
            return;
        }
        
        const site = await response.json();
        
        document.getElementById('site-detail-name').textContent = site.name;
        document.getElementById('site-detail-address').textContent = site.address;
        document.getElementById('site-detail-status-badge').textContent = site.status;
        document.getElementById('site-detail-status-badge').className = `status-badge status-${site.status.toLowerCase()}`;
        document.getElementById('site-detail-start').textContent = site.start_date || '-';
        document.getElementById('site-detail-end').textContent = site.end_date || '-';
        
        if (site.address) {
            document.getElementById('site-detail-address-link').href = 
                `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.address)}`;
        }
        
        renderConstructionNotes(site.notes || []);
        renderConstructionDocuments(site.documents || []);
        
        setupSiteFileUpload();
        
        // Innendienst-Modus: Bearbeitungsbuttons ausblenden
        updateConstructionSiteDetailButtons();
        
        document.querySelectorAll('.content-section').forEach(s => s.style.display = 'none');
        document.getElementById('construction-detail-section').style.display = 'block';
    } catch (error) {
        console.error('[SITE] Fehler beim Laden:', error);
        showContent('construction');
    }
}

// Funktion zum Aktualisieren der Baustellen-Buttons basierend auf dem Modus
function updateConstructionSiteDetailButtons() {
    const editBtn = document.querySelector('#construction-detail-section button[onclick="editConstructionSiteFromDetail()"]');
    const deleteBtn = document.querySelector('#construction-detail-section button[onclick="deleteConstructionSiteFromDetail()"]');
    const noteBtn = document.querySelector('#construction-detail-section button[onclick="openNoteModal()"]');
    const docBtn = document.querySelector('#construction-detail-section button[onclick="openSiteDocumentModal()"]');
    const dropZone = document.getElementById('site-drop-zone');
    const backBtn = document.querySelector('#construction-detail-section button[onclick*="showContent"], #construction-detail-section button[onclick*="goBackSafe"]');
    
    if (isInnendienstViewMode) {
        // Verstecke alle Bearbeitungsbuttons
        if (editBtn) editBtn.style.display = 'none';
        if (deleteBtn) deleteBtn.style.display = 'none';
        if (noteBtn) noteBtn.style.display = 'none';
        if (docBtn) docBtn.style.display = 'none';
        if (dropZone) dropZone.style.display = 'none';
        // FIX: Sichere Zurück-Navigation verwenden
        if (backBtn) backBtn.setAttribute('onclick', 'goBackSafeFromConstruction()');
    } else {
        // Zeige alle Bearbeitungsbuttons
        if (editBtn) editBtn.style.display = '';
        if (deleteBtn) deleteBtn.style.display = '';
        if (noteBtn) noteBtn.style.display = '';
        if (docBtn) docBtn.style.display = '';
        if (dropZone) dropZone.style.display = '';
        // FIX: Sichere Zurück-Navigation verwenden
        if (backBtn) backBtn.setAttribute('onclick', 'goBackSafeFromConstruction()');
    }
}

// FIX: Sichere Zurück-Navigation für Baustellen
function goBackSafeFromConstruction() {
    // SICHERHEITSPRÜFUNG: Nur Innendienst-Benutzer dürfen zum Innendienst-Dashboard
    if (isInnendienstViewMode && currentUser && currentUser.role === 'Innendienst') {
        isInnendienstViewMode = false;
        showContent('innendienst');
        // Daten erneut laden, falls ein Außendienst ausgewählt war
        if (selectedAussendienstUserId) {
            document.getElementById('innendienst-user-select').value = selectedAussendienstUserId;
            loadInnendienstData();
        }
    } else {
        // Außendienst-Benutzer gehen zur Baustellenübersicht zurück
        isInnendienstViewMode = false;
        showContent('construction');
    }
}

function renderConstructionNotes(notes) {
    const container = document.getElementById('construction-notes-list');
    if (!notes || notes.length === 0) {
        container.innerHTML = '<div class="text-center py-8 text-gray-500 text-sm">Keine Notizen vorhanden</div>';
        return;
    }
    
    container.innerHTML = notes.map(note => `
        <div class="bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded">
            <div class="flex justify-between items-start mb-2">
                <div class="text-xs text-gray-600"><i class="fas fa-user mr-1"></i>${note.created_by} · ${note.created_at}</div>
                ${!isInnendienstViewMode ? `<button onclick="deleteNote(${note.id})" class="icon-button text-red-500 text-xs"><i class="fas fa-trash"></i></button>` : ''}
            </div>
            <p class="text-sm text-gray-800">${note.note}</p>
        </div>
    `).join('');
}

function renderConstructionDocuments(documents) {
    const container = document.getElementById('construction-documents-list');
    if (!documents || documents.length === 0) {
        container.innerHTML = '<div class="text-center py-8 text-gray-500 text-sm">Keine Dokumente vorhanden</div>';
        return;
    }
    
    container.innerHTML = documents.map(doc => `
        <div class="bg-white border border-gray-200 p-3 rounded-lg">
            <div class="flex justify-between items-start">
                <div class="flex-grow">
                    <div class="font-semibold text-sm">${doc.name}</div>
                    <div class="text-xs text-gray-500 mt-1">
                        <span class="inline-block px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs mr-1">${doc.type}</span>
                        ${doc.created_at}
                    </div>
                </div>
                <div class="flex space-x-1">
                    ${doc.file_url ? `<a href="${doc.file_url}" target="_blank" class="icon-button text-blue-600 text-xs"><i class="fas fa-external-link-alt"></i></a>` : ''}
                    ${doc.has_file ? `<button onclick="downloadDocument(${doc.id})" class="icon-button text-green-600 text-xs"><i class="fas fa-download"></i></button>` : ''}
                    ${!isInnendienstViewMode ? `<button onclick="deleteDocument(${doc.id})" class="icon-button text-red-500 text-xs"><i class="fas fa-trash"></i></button>` : ''}
                </div>
            </div>
        </div>
    `).join('');
}

function setupSiteFileUpload() {
    const dropZone = document.getElementById('site-drop-zone');
    const fileInput = document.getElementById('site-file-input');
    
    if (!dropZone || !fileInput) return;
    
    const newDropZone = dropZone.cloneNode(true);
    dropZone.parentNode.replaceChild(newDropZone, dropZone);
    
    const newFileInput = document.getElementById('site-file-input');
    
    newDropZone.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        newFileInput.click();
    };
    
    newDropZone.ondragover = function(e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.add('dragover');
    };
    
    newDropZone.ondragleave = function(e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove('dragover');
    };
    
    newDropZone.ondrop = function(e) {
        e.preventDefault();
        e.stopPropagation();
        this.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleSiteFilesSequential(Array.from(files));
        }
    };
    
    newFileInput.onchange = function(e) {
        const files = e.target.files;
        if (files.length > 0) {
            handleSiteFilesSequential(Array.from(files));
        }
        this.value = '';
    };
}

async function handleSiteFilesSequential(files) {
    if (uploadInProgressSite) {
        console.log('[UPLOAD] Baustelle: Bereits in Bearbeitung');
        return;
    }
    
    uploadInProgressSite = true;
    
    for (const file of files) {
        const fileKey = `${file.name}_${file.size}_${file.lastModified}`;
        if (uploadedFilesSite.has(fileKey)) {
            continue;
        }
        
        uploadedFilesSite.add(fileKey);
        
        try {
            await uploadSingleFile(file, null, currentConstructionSiteId);
            showMessage(`${file.name} hochgeladen!`, 'success');
        } catch (error) {
            console.error(`[UPLOAD] Fehler bei ${file.name}:`, error);
        }
    }
    
    uploadInProgressSite = false;
    showConstructionSiteDetail(currentConstructionSiteId);
}

function openConstructionSiteModal(site = null) {
    const modal = document.getElementById('constructionSiteModal');
    modal.innerHTML = `
        <div class="modal-content">
            <h2 class="text-2xl font-bold mb-6">${site ? 'Baustelle bearbeiten' : 'Neue Baustelle'}</h2>
            <div class="space-y-4">
                <input type="hidden" id="edit-site-id" value="${site ? site.id : ''}">
                <div><label>Baustellenname *</label><input type="text" id="site-name" value="${site ? site.name : ''}"></div>
                <div><label>Adresse *</label><input type="text" id="site-address" value="${site ? site.address : ''}"></div>
                <div><label>Status</label>
                    <select id="site-status">
                        <option value="Planung" ${site && site.status === 'Planung' ? 'selected' : ''}>Planung</option>
                        <option value="Aktiv" ${site && site.status === 'Aktiv' ? 'selected' : ''}>Aktiv</option>
                        <option value="Abgeschlossen" ${site && site.status === 'Abgeschlossen' ? 'selected' : ''}>Abgeschlossen</option>
                    </select>
                </div>
                <div class="grid grid-cols-2 gap-4">
                    <div><label>Startdatum</label><input type="date" id="site-start-date" value="${site ? site.start_date || '' : ''}"></div>
                    <div><label>Enddatum</label><input type="date" id="site-end-date" value="${site ? site.end_date || '' : ''}"></div>
                </div>
            </div>
            <div class="flex justify-end gap-3 mt-6">
                <button class="secondary-button" onclick="closeModal('constructionSiteModal')">Abbrechen</button>
                <button class="action-button" onclick="saveConstructionSite()">Speichern</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
}

async function saveConstructionSite() {
    const id = document.getElementById('edit-site-id').value;
    const data = {
        customer_id: currentCustomerId,
        name: document.getElementById('site-name').value.trim(),
        address: document.getElementById('site-address').value.trim(),
        status: document.getElementById('site-status').value,
        start_date: document.getElementById('site-start-date').value,
        end_date: document.getElementById('site-end-date').value
    };
    
    if (!data.name || !data.address) {
        showMessage('Name und Adresse erforderlich!', 'warning');
        return;
    }
    
    const url = id ? `${API_BASE_URL}/constructionsites/${id}` : `${API_BASE_URL}/constructionsites`;
    const response = await fetch(url, {
        method: id ? 'PUT' : 'POST',
        headers: getAuthHeaders(),  // FIX: Auth Headers verwenden
        credentials: 'include',
        body: JSON.stringify(data)
    });
    
    if (response.ok) {
        showMessage(id ? 'Baustelle aktualisiert!' : 'Baustelle erstellt!', 'success');
        closeModal('constructionSiteModal');
        if (currentCustomerId) showCustomerDetail(currentCustomerId);
        else loadAllConstructionSites();
    } else if (response.status === 401) {
        showMessage('Sitzung abgelaufen - bitte neu anmelden', 'warning');
    } else {
        showMessage('Fehler beim Speichern', 'error');
    }
}

function editConstructionSiteFromDetail() {
    fetch(`${API_BASE_URL}/constructionsites/${currentConstructionSiteId}`, { headers: getAuthHeaders(), credentials: 'include' })
        .then(r => r.json())
        .then(site => openConstructionSiteModal(site));
}

async function deleteConstructionSiteFromDetail() {
    if (!(await confirmAction('Baustelle wirklich löschen?'))) return;
    await fetch(`${API_BASE_URL}/constructionsites/${currentConstructionSiteId}`, { method: 'DELETE', headers: getAuthHeaders(), credentials: 'include' });
    showMessage('Baustelle gelöscht', 'success');
    showContent('construction');
}

function openNoteModal() {
    const modal = document.getElementById('noteModal');
    modal.innerHTML = `
        <div class="modal-content">
            <h2 class="text-2xl font-bold mb-6">Neue Notiz</h2>
            <div><label>Notiz *</label><textarea id="note-text" rows="4" placeholder="Notiz eingeben..."></textarea></div>
            <div class="flex justify-end gap-3 mt-6">
                <button class="secondary-button" onclick="closeModal('noteModal')">Abbrechen</button>
                <button class="action-button" onclick="saveNote()">Speichern</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
}

async function saveNote() {
    const text = document.getElementById('note-text').value.trim();
    if (!text) { showMessage('Notiz eingeben!', 'warning'); return; }
    
    const response = await fetch(`${API_BASE_URL}/constructionsites/${currentConstructionSiteId}/notes`, {
        method: 'POST',
        headers: getAuthHeaders(),  // FIX: Auth Headers verwenden
        credentials: 'include',
        body: JSON.stringify({ note: text })
    });
    
    if (response.ok) {
        showMessage('Notiz gespeichert!', 'success');
        closeModal('noteModal');
        showConstructionSiteDetail(currentConstructionSiteId);
    } else if (response.status === 401) {
        showMessage('Sitzung abgelaufen - bitte neu anmelden', 'warning');
    } else {
        showMessage('Fehler beim Speichern', 'error');
    }
}

async function deleteNote(id) {
    if (!(await confirmAction('Notiz löschen?'))) return;
    await fetch(`${API_BASE_URL}/constructionnotes/${id}`, { method: 'DELETE', headers: getAuthHeaders(), credentials: 'include' });
    showMessage('Notiz gelöscht', 'success');
    showConstructionSiteDetail(currentConstructionSiteId);
}

function openSiteDocumentModal() {
    const modal = document.getElementById('documentModal');
    modal.innerHTML = `
        <div class="modal-content">
            <h2 class="text-2xl font-bold mb-6">Neues Dokument (Link)</h2>
            <div class="space-y-4">
                <div><label>Name *</label><input type="text" id="site-document-name"></div>
                <div><label>Typ *</label>
                    <select id="site-document-type">
                        <option value="PDF">PDF</option>
                        <option value="Plan">Plan</option>
                        <option value="Angebot">Angebot</option>
                        <option value="Rechnung">Rechnung</option>
                        <option value="Foto">Foto</option>
                    </select>
                </div>
                <div><label>Link/URL</label><input type="text" id="site-document-url"></div>
            </div>
            <div class="flex justify-end gap-3 mt-6">
                <button class="secondary-button" onclick="closeModal('documentModal')">Abbrechen</button>
                <button class="action-button" onclick="saveSiteDocument()">Speichern</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
}

async function saveSiteDocument() {
    const data = {
        construction_site_id: currentConstructionSiteId,
        name: document.getElementById('site-document-name').value.trim(),
        type: document.getElementById('site-document-type').value,
        file_url: document.getElementById('site-document-url').value.trim()
    };
    
    if (!data.name) { showMessage('Name erforderlich!', 'warning'); return; }
    
    const response = await fetch(`${API_BASE_URL}/documents`, {
        method: 'POST',
        headers: getAuthHeaders(),  // FIX: Auth Headers verwenden
        credentials: 'include',
        body: JSON.stringify(data)
    });
    
    if (response.ok) {
        showMessage('Dokument gespeichert!', 'success');
        closeModal('documentModal');
        showConstructionSiteDetail(currentConstructionSiteId);
    } else if (response.status === 401) {
        showMessage('Sitzung abgelaufen - bitte neu anmelden', 'warning');
    } else {
        showMessage('Fehler beim Speichern', 'error');
    }
}

// ===================================================
// TOURPLANUNG
// ===================================================

async function loadTours() {
    const container = document.getElementById('tour-list-container');
    container.innerHTML = '<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-3xl text-blue-500"></i></div>';

    try {
        const response = await fetch(`${API_BASE_URL}/tours?archived=false`, { 
            headers: getAuthHeaders(),
            credentials: 'include' 
        });
        const tours = await response.json();

        if (!tours || tours.length === 0) {
            container.innerHTML = '<div class="text-center py-12 text-gray-500">Keine aktiven Touren. Erstellen Sie eine neue Tour!</div>';
            return;
        }

        container.innerHTML = tours.map(tour => `
            <div class="tour-card">
                <div class="flex-grow">
                    <div class="flex items-center justify-between mb-3">
                        <div class="font-bold text-2xl text-blue-700">${tour.title}</div>
                        <div class="flex space-x-2">
                            <button onclick="completeTour(${tour.id})" class="action-button text-sm" style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);">
                                <i class="fas fa-check mr-1"></i>Erledigt
                            </button>
                            <button onclick="deleteTour(${tour.id})" class="icon-button text-red-600"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>
                    <div class="space-y-2 mb-4">
                        ${tour.stops.map(stop => `
                            <div class="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                                <span class="font-bold text-blue-600 text-lg">${stop.order}.</span>
                                <div class="flex-grow">
                                    <div class="font-semibold">${stop.customer_name}</div>
                                    <div class="text-xs text-gray-500">${stop.address}</div>
                                    ${stop.goal ? `<div class="text-xs italic text-gray-600 mt-1">${stop.goal}</div>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <button onclick="openGoogleMapsRoute(${tour.id})" class="action-button w-full">
                        <i class="fas fa-route mr-2"></i>Route in Google Maps öffnen
                    </button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Fehler beim Laden der Touren:', error);
        container.innerHTML = '<div class="text-center py-12 text-gray-500">Keine aktiven Touren</div>';
    }
}

async function loadArchivedTours() {
    const container = document.getElementById('archive-list-container');
    container.innerHTML = '<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-3xl text-blue-500"></i></div>';

    try {
        const response = await fetch(`${API_BASE_URL}/tours?archived=true`, { 
            headers: getAuthHeaders(),
            credentials: 'include' 
        });
        const tours = await response.json();

        if (!tours || tours.length === 0) {
            container.innerHTML = '<div class="text-center py-12 text-gray-500">Keine archivierten Touren</div>';
            return;
        }

        container.innerHTML = tours.map(tour => `
            <div class="card">
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <div class="font-bold text-xl">${tour.title}</div>
                        <div class="text-sm text-gray-500 mt-1"><i class="fas fa-check-circle text-green-600 mr-1"></i>Abgeschlossen: ${tour.completed_at || '-'}</div>
                    </div>
                    <button onclick="deleteTour(${tour.id})" class="icon-button text-red-600"><i class="fas fa-trash"></i></button>
                </div>
                <div class="space-y-1">
                    ${tour.stops.map(stop => `<div class="text-sm text-gray-700">${stop.order}. ${stop.customer_name} - ${stop.address}</div>`).join('')}
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Fehler beim Laden der archivierten Touren:', error);
        container.innerHTML = '<div class="text-center py-12 text-gray-500">Keine archivierten Touren</div>';
    }
}

async function openGoogleMapsRoute(tourId) {
    const response = await fetch(`${API_BASE_URL}/tours?archived=false`, { headers: getAuthHeaders(), credentials: 'include' });
    const tours = await response.json();
    const tour = tours.find(t => t.id === tourId);
    
    if (!tour || tour.stops.length === 0) return;
    
    const origin = encodeURIComponent(tour.stops[0].address);
    const destination = encodeURIComponent(tour.stops[tour.stops.length - 1].address);
    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
    
    if (tour.stops.length > 2) {
        url += `&waypoints=${tour.stops.slice(1, -1).map(s => encodeURIComponent(s.address)).join('|')}`;
    }
    
    window.open(url + '&travelmode=driving', '_blank');
}

function openTourModal() {
    const modal = document.getElementById('tourModal');
    modal.innerHTML = `
        <div class="modal-content">
            <h2 class="text-2xl font-bold mb-6">Neue Tour erstellen</h2>
            <div class="mb-4">
                <label>Tour-Titel *</label>
                <input type="text" id="tour-title" placeholder="z.B. Montags-Tour Berlin">
            </div>
            <div class="card mb-6 bg-blue-50 border border-blue-200">
                <h3 class="font-bold text-lg mb-3 text-blue-900">Stopp hinzufügen</h3>
                <div class="space-y-3">
                    <input list="customerDatalist" id="tourCustomerName" placeholder="Kundenname" onchange="fillCustomerAddress()">
                    <input type="text" id="tourAddress" placeholder="Adresse">
                    <input type="text" id="tourGoal" placeholder="Besuchsziel (optional)">
                    <button class="action-button w-full" onclick="addTourStop()"><i class="fas fa-plus mr-2"></i>Stopp hinzufügen</button>
                </div>
            </div>
            <div id="tourStopsContainer" class="border border-gray-200 rounded-lg max-h-64 overflow-y-auto mb-6"></div>
            <div class="flex justify-end gap-3">
                <button class="secondary-button" onclick="closeModal('tourModal')">Abbrechen</button>
                <button class="action-button" onclick="saveTour()">Tour speichern</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
    currentTourStops = [];
    renderTourStops();
    
    // Kunden für Autocomplete laden
    fetch(`${API_BASE_URL}/customers`, { headers: getAuthHeaders(), credentials: 'include' })
        .then(r => r.json())
        .then(customers => {
            if (customers && customers.length > 0) {
                updateCustomerDatalist(customers);
            }
        });
}

function fillCustomerAddress() {
    const name = document.getElementById('tourCustomerName').value;
    const datalist = document.getElementById('customerDatalist');
    if (datalist) {
        const options = datalist.querySelectorAll('option');
        for (let opt of options) {
            if (opt.value === name && opt.dataset.address) {
                document.getElementById('tourAddress').value = opt.dataset.address;
                break;
            }
        }
    }
}

function renderTourStops() {
    const container = document.getElementById('tourStopsContainer');
    if (currentTourStops.length === 0) {
        container.innerHTML = '<div class="text-center py-6 text-gray-500">Noch keine Stopps hinzugefügt</div>';
        return;
    }
    container.innerHTML = currentTourStops.map((stop, i) => `
        <div class="flex items-center justify-between p-3 border-b">
            <div>
                <div class="font-semibold">${i + 1}. ${stop.customer_name}</div>
                <div class="text-sm text-gray-600">${stop.address}</div>
                ${stop.goal ? `<div class="text-xs text-gray-500 italic">${stop.goal}</div>` : ''}
            </div>
            <div class="space-x-2">
                <button onclick="moveTourStop(${i}, -1)" class="icon-button" ${i === 0 ? 'disabled' : ''}><i class="fas fa-chevron-up"></i></button>
                <button onclick="moveTourStop(${i}, 1)" class="icon-button" ${i === currentTourStops.length - 1 ? 'disabled' : ''}><i class="fas fa-chevron-down"></i></button>
                <button onclick="removeTourStop(${i})" class="icon-button text-red-500"><i class="fas fa-times"></i></button>
            </div>
        </div>
    `).join('');
}

function addTourStop() {
    const name = document.getElementById('tourCustomerName').value.trim();
    const address = document.getElementById('tourAddress').value.trim();
    const goal = document.getElementById('tourGoal').value.trim();
    
    if (!name || !address) { 
        showMessage('Name und Adresse erforderlich!', 'warning'); 
        return; 
    }
    
    currentTourStops.push({ customer_name: name, address, goal });
    renderTourStops();
    
    document.getElementById('tourCustomerName').value = '';
    document.getElementById('tourAddress').value = '';
    document.getElementById('tourGoal').value = '';
}

function removeTourStop(i) { 
    currentTourStops.splice(i, 1); 
    renderTourStops(); 
}

function moveTourStop(i, dir) {
    const ni = i + dir;
    if (ni >= 0 && ni < currentTourStops.length) {
        [currentTourStops[i], currentTourStops[ni]] = [currentTourStops[ni], currentTourStops[i]];
        renderTourStops();
    }
}

async function saveTour() {
    const title = document.getElementById('tour-title').value.trim();
    if (!title) { showMessage('Titel eingeben!', 'warning'); return; }
    if (currentTourStops.length === 0) { showMessage('Mindestens einen Stopp hinzufügen!', 'warning'); return; }
    
    try {
        console.log('[TOUR] Speichere Tour:', title, currentTourStops);
        
        const response = await fetch(`${API_BASE_URL}/tours`, {
            method: 'POST',
            headers: getAuthHeaders(),
            credentials: 'include',
            body: JSON.stringify({ title, stops: currentTourStops })
        });
        
        console.log('[TOUR] Response Status:', response.status);
        
        if (response.ok) {
            showMessage('Tour gespeichert!', 'success');
            closeModal('tourModal');
            loadTours();
        } else if (response.status === 401) {
            showMessage('Sitzung abgelaufen - bitte neu anmelden', 'warning');
            setTimeout(() => location.reload(), 1500);
        } else {
            const errorData = await response.json().catch(() => ({}));
            showMessage(errorData.message || 'Fehler beim Speichern', 'warning');
        }
    } catch (error) {
        console.error('[TOUR] Netzwerkfehler:', error);
        showMessage('Verbindungsfehler - Server erreichbar?', 'warning');
    }
}

async function completeTour(id) {
    if (!(await confirmAction('Tour als erledigt markieren und archivieren?'))) return;
    await fetch(`${API_BASE_URL}/tours/${id}/complete`, { method: 'POST', headers: getAuthHeaders(), credentials: 'include' });
    showMessage('Tour archiviert!', 'success');
    loadTours();
}

async function deleteTour(id) {
    if (!(await confirmAction('Tour löschen?'))) return;
    await fetch(`${API_BASE_URL}/tours/${id}`, { method: 'DELETE', headers: getAuthHeaders(), credentials: 'include' });
    showMessage('Tour gelöscht', 'success');
    loadTours();
    loadArchivedTours();
}

// ===================================================
// INNENDIENST DASHBOARD
// ===================================================

async function loadInnendienstUsers() {
    try {
        const response = await fetch(`${API_BASE_URL}/users`, { headers: getAuthHeaders(), credentials: 'include' });
        const users = await response.json();
        
        const select = document.getElementById('innendienst-user-select');
        const aussendienst = users.filter(u => u.role === 'Außendienst');
        
        select.innerHTML = '<option value="">Bitte wählen...</option>' + 
            aussendienst.map(u => `<option value="${u.id}">${u.username}</option>`).join('');
        
        document.getElementById('innendienst-content').style.display = 'none';
    } catch (error) {
        console.error('Fehler:', error);
    }
}

async function loadInnendienstData() {
    const userId = document.getElementById('innendienst-user-select').value;
    
    if (!userId) {
        document.getElementById('innendienst-content').style.display = 'none';
        selectedAussendienstUserId = null;
        cachedInnendienstData = null;
        return;
    }
    
    selectedAussendienstUserId = userId;
    document.getElementById('innendienst-content').style.display = 'block';
    
    ['innendienst-tours', 'innendienst-archive', 'innendienst-customers', 'innendienst-sites'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '<div class="text-center py-4"><i class="fas fa-spinner fa-spin"></i></div>';
    });
    
    try {
            const response = await fetch(`${API_BASE_URL}/users/aussendienst/${userId}/data`, {
                headers: getAuthHeaders(),  // <--- Hier fehlte es auch!
                credentials: 'include'
            });
        
        let data = { active_tours: [], archived_tours: [], customers: [], construction_sites: [], user: {} };
        
        if (response.ok) {
            data = await response.json();
            cachedInnendienstData = data;
            console.log('[INNENDIENST] Daten geladen für', data.user?.username || userId);
        } else {
            console.log('[INNENDIENST] Keine Daten verfügbar');
            cachedInnendienstData = data;
        }
        
        // Aktive Touren - klickbar für Detailansicht
        const toursHTML = (data.active_tours && data.active_tours.length > 0) ? data.active_tours.map(t => `
            <div class="mb-3 p-3 bg-blue-50 rounded-lg border border-blue-200 cursor-pointer hover:bg-blue-100 transition-colors" onclick="showTourDetailFromInnendienst(${t.id}, false)">
                <div class="font-bold text-blue-800">${t.title}</div>
                <div class="text-xs text-gray-500 mb-2">Erstellt: ${t.created_at}</div>
                ${t.stops && t.stops.length > 0 ? t.stops.map(s => `
                    <div class="pl-2 border-l-2 border-blue-400 text-sm mb-1">
                        <strong>${s.order}.</strong> ${s.customer_name}
                    </div>
                `).join('') : '<div class="text-gray-500 text-xs">Keine Stopps</div>'}
            </div>
        `).join('') : '<div class="text-center text-gray-500 py-4">Keine aktiven Touren</div>';
        document.getElementById('innendienst-tours').innerHTML = toursHTML;
        
        // Archivierte Touren - klickbar für Detailansicht
        const archiveHTML = (data.archived_tours && data.archived_tours.length > 0) ? data.archived_tours.map(t => `
            <div class="mb-3 p-3 bg-gray-100 rounded-lg cursor-pointer hover:bg-gray-200 transition-colors" onclick="showTourDetailFromInnendienst(${t.id}, true)">
                <div class="font-semibold">${t.title}</div>
                <div class="text-xs text-green-600 mb-1"><i class="fas fa-check-circle mr-1"></i>Abgeschlossen: ${t.completed_at || '-'}</div>
            </div>
        `).join('') : '<div class="text-center text-gray-500 py-4">Keine archivierten Touren</div>';
        document.getElementById('innendienst-archive').innerHTML = archiveHTML;
        
        // Kunden
        const customersHTML = (data.customers && data.customers.length > 0) ? data.customers.map(c => `
            <div class="border-b py-2 hover:bg-gray-50 cursor-pointer" onclick="showCustomerDetailFromInnendienst(${c.id})">
                <div class="font-semibold">${c.name}</div>
                <div class="text-xs text-gray-500">#${c.customer_number}</div>
                <div class="text-xs text-gray-600">${c.address || 'Keine Adresse'}</div>
            </div>
        `).join('') : '<div class="text-center text-gray-500 py-4">Keine Kunden</div>';
        document.getElementById('innendienst-customers').innerHTML = customersHTML;
        
        // Baustellen
        const sitesHTML = (data.construction_sites && data.construction_sites.length > 0) ? data.construction_sites.map(s => `
            <div class="border-b py-2 hover:bg-gray-50 cursor-pointer" onclick="showConstructionSiteDetailFromInnendienst(${s.id})">
                <div class="font-semibold">${s.name}</div>
                <div class="text-xs text-gray-600">${s.address}</div>
                <span class="status-badge status-${s.status.toLowerCase()} text-xs mt-1">${s.status}</span>
            </div>
        `).join('') : '<div class="text-center text-gray-500 py-4">Keine Baustellen</div>';
        document.getElementById('innendienst-sites').innerHTML = sitesHTML;
        
    } catch (error) {
        console.error('[INNENDIENST] Fehler:', error);
        cachedInnendienstData = null;
        // Keine Fehlermeldung anzeigen, stattdessen leere Listen
        document.getElementById('innendienst-tours').innerHTML = '<div class="text-center text-gray-500 py-4">Keine aktiven Touren</div>';
        document.getElementById('innendienst-archive').innerHTML = '<div class="text-center text-gray-500 py-4">Keine archivierten Touren</div>';
        document.getElementById('innendienst-customers').innerHTML = '<div class="text-center text-gray-500 py-4">Keine Kunden</div>';
        document.getElementById('innendienst-sites').innerHTML = '<div class="text-center text-gray-500 py-4">Keine Baustellen</div>';
    }
}

async function showCustomerDetailFromInnendienst(customerId) {
    isInnendienstViewMode = true;
    await showCustomerDetail(customerId);
}

// Tour-Detailansicht für Innendienst (Read-Only)
async function showTourDetailFromInnendienst(tourId, isArchived) {
    isInnendienstViewMode = true;
    
    // Finde Tour in den gecachten Daten
    let tour = null;
    if (cachedInnendienstData) {
        if (isArchived) {
            tour = cachedInnendienstData.archived_tours.find(t => t.id === tourId);
        } else {
            tour = cachedInnendienstData.active_tours.find(t => t.id === tourId);
        }
    }
    
    if (!tour) {
        showMessage('Tour nicht gefunden', 'warning');
        return;
    }
    
    // Zeige Tour im Modal (Read-Only)
    const modal = document.getElementById('tourModal');
    modal.innerHTML = `
        <div class="modal-content">
            <div class="flex justify-between items-start mb-6">
                <div>
                    <h2 class="text-2xl font-bold">${tour.title}</h2>
                    <p class="text-sm text-gray-500 mt-1">
                        ${isArchived ? 
                            `<span class="text-green-600"><i class="fas fa-check-circle mr-1"></i>Abgeschlossen: ${tour.completed_at || '-'}</span>` : 
                            `<span class="text-blue-600"><i class="fas fa-route mr-1"></i>Aktive Tour</span>`
                        }
                    </p>
                </div>
                <button class="icon-button" onclick="closeModal('tourModal')">
                    <i class="fas fa-times text-xl"></i>
                </button>
            </div>
            
            <div class="space-y-3 mb-6">
                ${tour.stops && tour.stops.length > 0 ? tour.stops.map(stop => `
                    <div class="flex items-center space-x-3 p-4 bg-gray-50 rounded-lg">
                        <span class="font-bold text-blue-600 text-xl">${stop.order}.</span>
                        <div class="flex-grow">
                            <div class="font-semibold text-lg">${stop.customer_name}</div>
                            <div class="text-sm text-gray-600"><i class="fas fa-map-marker-alt mr-1"></i>${stop.address}</div>
                            ${stop.goal ? `<div class="text-sm italic text-gray-500 mt-1"><i class="fas fa-bullseye mr-1"></i>${stop.goal}</div>` : ''}
                        </div>
                    </div>
                `).join('') : '<div class="text-center text-gray-500 py-4">Keine Stopps in dieser Tour</div>'}
            </div>
            
            ${!isArchived && tour.stops && tour.stops.length > 0 ? `
                <button onclick="openGoogleMapsRouteFromModal()" class="action-button w-full">
                    <i class="fas fa-route mr-2"></i>Route in Google Maps öffnen
                </button>
            ` : ''}
            
            <div class="text-center mt-4">
                <button class="secondary-button" onclick="closeModal('tourModal')">Schließen</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
    
    // Speichere Tour temporär für Maps-Funktion
    window.currentInnendienstTour = tour;
}

// Google Maps Route öffnen aus Innendienst-Modal
function openGoogleMapsRouteFromModal() {
    const tour = window.currentInnendienstTour;
    if (!tour || !tour.stops || tour.stops.length === 0) return;
    
    const origin = encodeURIComponent(tour.stops[0].address);
    const destination = encodeURIComponent(tour.stops[tour.stops.length - 1].address);
    let url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
    
    if (tour.stops.length > 2) {
        url += `&waypoints=${tour.stops.slice(1, -1).map(s => encodeURIComponent(s.address)).join('|')}`;
    }
    
    window.open(url + '&travelmode=driving', '_blank');
}

// Baustellen-Detailansicht für Innendienst (Read-Only)
async function showConstructionSiteDetailFromInnendienst(siteId) {
    isInnendienstViewMode = true;
    await showConstructionSiteDetail(siteId);
}

// ===================================================
// ADMIN
// ===================================================

async function loadUsers() {
    try {
        const response = await fetch(`${API_BASE_URL}/users`, { headers: getAuthHeaders(), credentials: 'include' });
        const users = await response.json();
        
        document.getElementById('user-list-body').innerHTML = users.map(u => `
            <tr class="hover:bg-gray-50">
                <td class="px-4 py-3 font-medium">${u.username}</td>
                <td class="px-4 py-3">
                    <span class="inline-block px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">${u.role}</span>
                    ${u.is_admin ? '<span class="inline-block px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs font-medium ml-1">Admin</span>' : ''}
                </td>
                <td class="px-4 py-3">${u.id > 1 ? `<button onclick="deleteUser(${u.id})" class="text-red-500 hover:text-red-700 font-medium">Löschen</button>` : '<span class="text-gray-400">System</span>'}</td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Fehler:', error);
    }
}

async function createUser() {
    const data = {
        username: document.getElementById('new-user-name').value.trim(),
        password: document.getElementById('new-user-pass').value,
        role: document.getElementById('new-user-role').value,
        is_admin: document.getElementById('new-user-admin').checked
    };
    
    if (!data.username || !data.password) { 
        showMessage('Name und Passwort erforderlich!', 'warning'); 
        return; 
    }

    const response = await fetch(`${API_BASE_URL}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
    });

    if (response.ok) {
        showMessage('Benutzer erstellt!', 'success');
        document.getElementById('new-user-name').value = '';
        document.getElementById('new-user-pass').value = '';
        document.getElementById('new-user-admin').checked = false;
        loadUsers();
    } else {
        try {
            const error = await response.json();
            if (error.message && error.message.includes('existiert')) {
                showMessage(error.message, 'warning');
            }
        } catch(e) {}
    }
}

async function deleteUser(id) {
    if (!(await confirmAction('Benutzer wirklich löschen?'))) return;
    await fetch(`${API_BASE_URL}/users/${id}`, { method: 'DELETE', headers: getAuthHeaders(), credentials: 'include' });
    showMessage('Benutzer gelöscht', 'success');
    loadUsers();
}

// ===================================================
// HILFSFUNKTIONEN
// ===================================================

function showMessage(message, type = 'info') {
    const box = document.getElementById('messageBox');
    box.textContent = message;
    
    const colors = {
        success: '#22c55e',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6'
    };
    box.style.background = colors[type] || colors.info;
    
    box.classList.add('show');
    setTimeout(() => box.classList.remove('show'), 3500);
}

function confirmAction(message) {
    return new Promise(resolve => {
        const modal = document.getElementById('confirmModal');
        modal.innerHTML = `
            <div class="modal-content max-w-sm text-center">
                <div class="text-5xl text-yellow-500 mb-4"><i class="fas fa-exclamation-triangle"></i></div>
                <p class="text-lg font-medium mb-6">${message}</p>
                <div class="flex justify-center gap-4">
                    <button id="confirmNo" class="secondary-button px-8">Nein</button>
                    <button id="confirmYes" class="action-button px-8" style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);">Ja</button>
                </div>
            </div>
        `;
        modal.style.display = 'flex';
        document.getElementById('confirmYes').onclick = () => { modal.style.display = 'none'; resolve(true); };
        document.getElementById('confirmNo').onclick = () => { modal.style.display = 'none'; resolve(false); };
    });
}

// ===================================================
// SPLASH SCREEN
// ===================================================

function hideSplashScreen() {
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.classList.add('fade-out');
        setTimeout(() => {
            splash.style.display = 'none';
        }, 600);
    }
}

function showSplashAndInit() {
    // Splash für mindestens 2.5 Sekunden zeigen
    const minSplashTime = 2500;
    const startTime = Date.now();
    
    // Auth-Check parallel starten
    checkAuth().then(() => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, minSplashTime - elapsed);
        
        setTimeout(() => {
            hideSplashScreen();
        }, remaining);
    }).catch(() => {
        // Bei Fehler auch Splash ausblenden
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, minSplashTime - elapsed);
        
        setTimeout(() => {
            hideSplashScreen();
        }, remaining);
    });
}

// App Start
document.addEventListener('DOMContentLoaded', () => showSplashAndInit());
