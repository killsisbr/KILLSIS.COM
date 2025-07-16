const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// --- DIRETÓRIOS ---
const authDbDir = path.join(__dirname, '..', '..', 'database');
if (!fs.existsSync(authDbDir)) fs.mkdirSync(authDbDir);

const userBaseDir = path.join(__dirname, '..', '..', 'user');
if (!fs.existsSync(userBaseDir)) fs.mkdirSync(userBaseDir);

// --- BANCO DE DADOS DE AUTENTICAÇÃO (CENTRAL) ---
const authDbPath = path.join(authDbDir, 'auth.db');
const authDb = new Database(authDbPath);

function initializeAuthDb() {
    authDb.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            client_id TEXT UNIQUE,
            command_whatsapp_number TEXT UNIQUE,
            delay_seconds INTEGER DEFAULT 3
        );
    `);
}
initializeAuthDb();

// --- GESTÃO DE BANCOS DE DADOS POR CLIENTE (DINÂMICO) ---
const userDbConnections = new Map(); // Cache para conexões de DB de cliente

/**
 * Garante que a pasta e o banco de dados de um cliente existam e retorna uma conexão.
 * A conexão é cacheada para reutilização.
 * @param {string} clientWhatsappNumber - O número de WhatsApp que identifica o cliente.
 * @returns {Database} Uma instância do better-sqlite3 para o DB do cliente.
 */
function getUserDb(clientWhatsappNumber) {
    if (userDbConnections.has(clientWhatsappNumber)) {
        return userDbConnections.get(clientWhatsappNumber);
    }

    const clientDbSubDir = path.join(userBaseDir, clientWhatsappNumber, 'database');
    if (!fs.existsSync(clientDbSubDir)) {
        fs.mkdirSync(clientDbSubDir, { recursive: true });
    }

    const userDbPath = path.join(clientDbSubDir, `${clientWhatsappNumber}.db`);
    const db = new Database(userDbPath);

    // Inicializa as tabelas do cliente
    db.exec(`
        CREATE TABLE IF NOT EXISTS contatos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cpf TEXT UNIQUE NOT NULL,
            nome TEXT,
            agencia TEXT,
            telefone TEXT,
            nascimento TEXT,
            data_envio_ultima_mensagem TEXT
        );
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS campaign_sends (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            contact_cpf TEXT,
            status TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    userDbConnections.set(clientWhatsappNumber, db);
    return db;
}

/**
 * Salva os dados de uma aba de planilha numa nova tabela no banco de dados do cliente.
 * @param {string} clientWhatsappNumber - O ID do cliente (número do WhatsApp).
 * @param {Array<Object>} sheetData - Os dados da planilha em formato JSON.
 * @param {string} sheetName - O nome da aba da planilha, que será usado para nomear a tabela.
 */
function saveSheetToDatabase(clientWhatsappNumber, sheetData, sheetName) {
    if (!sheetData || sheetData.length === 0) {
        throw new Error("Os dados da planilha estão vazios.");
    }

    const db = getUserDb(clientWhatsappNumber);
    
    // Sanitiza o nome da aba para criar um nome de tabela válido
    const tableName = `import_${sheetName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
    
    // Pega os cabeçalhos da primeira linha de dados
    const headers = Object.keys(sheetData[0]);
    
    // CORREÇÃO APLICADA: Lógica aprimorada para garantir nomes de coluna únicos
    const sanitizedColumns = headers.map(h => 
        (h || 'coluna_vazia').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()
    );

    const columnCounts = {};
    const finalColumns = sanitizedColumns.map(col => {
        if (columnCounts[col]) {
            columnCounts[col]++;
            return `${col}_${columnCounts[col]}`;
        }
        columnCounts[col] = 1;
        return col;
    });
    // FIM DA CORREÇÃO

    const columns = finalColumns;
    const columnDefinitions = columns.map(col => `"${col}" TEXT`).join(', ');

    // Cria a tabela
    db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}" (${columnDefinitions})`);

    // Prepara a inserção dos dados
    const placeholders = columns.map(() => '?').join(', ');
    const insert = db.prepare(`INSERT INTO "${tableName}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`);

    // Usa uma transação para inserir todos os dados de forma eficiente
    const insertMany = db.transaction((rows) => {
        for (const row of rows) {
            // Usa os cabeçalhos originais para buscar os valores
            const values = headers.map(header => row[header] !== undefined && row[header] !== null ? String(row[header]) : null);
            insert.run(values);
        }
    });

    insertMany(sheetData);
    console.log(`Dados da aba '${sheetName}' salvos com sucesso na tabela '${tableName}' para o cliente ${clientWhatsappNumber}.`);
}


/**
 * Lista todas as tabelas que foram importadas de planilhas.
 * @param {string} clientWhatsappNumber - O ID do cliente.
 * @returns {Array<string>} Uma lista com os nomes das tabelas importadas.
 */
function listImportedTables(clientWhatsappNumber) {
    const db = getUserDb(clientWhatsappNumber);
    const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'import_%'");
    return stmt.all().map(row => row.name);
}

/**
 * Obtém todos os dados de uma tabela de planilha importada específica.
 * @param {string} clientWhatsappNumber - O ID do cliente.
 * @param {string} tableName - O nome da tabela a ser consultada.
 * @returns {Array<Object>} Os dados da tabela.
 */
function getImportedSheetData(clientWhatsappNumber, tableName) {
    const db = getUserDb(clientWhatsappNumber);
    // Validação para garantir que o nome da tabela é seguro
    if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
        throw new Error("Nome de tabela inválido.");
    }
    const stmt = db.prepare(`SELECT * FROM "${tableName}"`);
    return stmt.all();
}


function closeAllConnections() {
    console.log("Fechando todas as conexões de banco de dados...");
    authDb.close();
    userDbConnections.forEach((db, number) => {
        db.close();
        console.log(`Conexão fechada para o cliente: ${number}`);
    });
    userDbConnections.clear();
    console.log("Todas as conexões foram fechadas.");
}

// --- FUNÇÕES DE AUTENTICAÇÃO (DB Central) ---
const findUserByUsername = (username) => authDb.prepare('SELECT * FROM users WHERE username = ?').get(username);
const findUserById = (id) => authDb.prepare('SELECT * FROM users WHERE id = ?').get(id);
const getAllUsers = () => authDb.prepare('SELECT * FROM users').all();
const findUserByWhatsappNumber = (whatsappNumber) => authDb.prepare('SELECT * FROM users WHERE command_whatsapp_number = ?').get(whatsappNumber);

function createUser(username, passwordHash) {
    try {
        const result = authDb.prepare('INSERT INTO users (username, password_hash, client_id, command_whatsapp_number) VALUES (?, ?, NULL, NULL)').run(username, passwordHash);
        console.log(`Utilizador ${username} criado. O número de WhatsApp será definido posteriormente.`);
        return result.lastInsertRowid;
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            throw new Error('Nome de usuário já existe.');
        }
        throw err;
    }
}

const updateUserWhatsappNumber = (userId, whatsappNumber) => {
    authDb.prepare('UPDATE users SET command_whatsapp_number = ?, client_id = ? WHERE id = ?').run(whatsappNumber, whatsappNumber, userId);
};

const updateUserDelay = (userId, delaySeconds) => {
    authDb.prepare('UPDATE users SET delay_seconds = ? WHERE id = ?').run(delaySeconds, userId);
};

const getUserDelay = (userId) => {
    const user = authDb.prepare('SELECT delay_seconds FROM users WHERE id = ?').get(userId);
    return user ? user.delay_seconds : null;
};

// --- FUNÇÕES DE DADOS (DBs Dinâmicos) ---

function saveOrUpdateContact(contactData, clientWhatsappNumber) {
    const db = getUserDb(clientWhatsappNumber); // Obtém conexão (cria DB se não existir)
    const existingContact = db.prepare('SELECT id FROM contatos WHERE cpf = ?').get(contactData.cpf);
    const today = new Date().toISOString();

    if (existingContact) {
        db.prepare('UPDATE contatos SET nome = ?, agencia = ?, telefone = ?, nascimento = ?, data_envio_ultima_mensagem = ? WHERE id = ?')
          .run(contactData.nome, contactData.agencia, contactData.telefone, contactData.nascimento, today, existingContact.id);
    } else {
        db.prepare('INSERT INTO contatos (cpf, nome, agencia, telefone, nascimento, data_envio_ultima_mensagem) VALUES (?, ?, ?, ?, ?, ?)')
          .run(contactData.cpf, contactData.nome, contactData.agencia, contactData.telefone, contactData.nascimento, today);
    }
}

function checkRecentSend(telefone, clientWhatsappNumber) {
    const db = getUserDb(clientWhatsappNumber);
    const contact = db.prepare('SELECT data_envio_ultima_mensagem FROM contatos WHERE telefone = ?').get(telefone);
    
    if (!contact || !contact.data_envio_ultima_mensagem) {
        return false;
    }

    const lastSendDate = new Date(contact.data_envio_ultima_mensagem);
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    return lastSendDate > ninetyDaysAgo;
}


function getFilteredContacts(clientWhatsappNumber, filter = 'default', searchTerm = '') {
    const db = getUserDb(clientWhatsappNumber);
    let baseQuery = 'SELECT * FROM contatos WHERE 1=1';
    const params = [];

    if (searchTerm && searchTerm.trim() !== '') {
        const likeTerm = `%${searchTerm}%`;
        baseQuery += ' AND (LOWER(nome) LIKE LOWER(?) OR cpf LIKE ? OR telefone LIKE ? OR nascimento LIKE ?)';
        params.push(likeTerm, likeTerm, likeTerm, likeTerm);
    }

    const hoje = new Date();
    const diaHoje = String(hoje.getDate()).padStart(2, '0');
    const mesHoje = String(hoje.getMonth() + 1).padStart(2, '0');

    switch(filter) {
        case 'ultimoEnvio':
            baseQuery += ' ORDER BY data_envio_ultima_mensagem DESC';
            break;
        case 'aniversariantesHoje':
            baseQuery += ' AND nascimento LIKE ?';
            params.push(`${diaHoje}/${mesHoje}/%`);
            break;
        case 'aniversariantesMes':
            baseQuery += ' AND nascimento LIKE ?';
            params.push(`%/${mesHoje}/%`);
            break;
        case 'cemMaisAntigos':
            baseQuery += ' ORDER BY data_envio_ultima_mensagem ASC LIMIT 100';
            break;
        default:
            baseQuery += ' ORDER BY data_envio_ultima_mensagem DESC';
            break;
    }
    return db.prepare(baseQuery).all(params);
}

const logCampaignSend = (clientWhatsappNumber, contactCpf, status) => {
    const db = getUserDb(clientWhatsappNumber);
    db.prepare('INSERT INTO campaign_sends (contact_cpf, status) VALUES (?, ?)')
      .run(contactCpf, status);
};

const getStats = (clientWhatsappNumber) => {
    const db = getUserDb(clientWhatsappNumber);
    const query = `
        SELECT status, COUNT(*) as count
        FROM campaign_sends
        GROUP BY status;
    `;
    return db.prepare(query).all();
};

function updateContact(id, data, clientWhatsappNumber) {
    const db = getUserDb(clientWhatsappNumber);
    const stmt = db.prepare('UPDATE contatos SET nome = ? WHERE id = ?');
    const result = stmt.run(data.nome, id);
    return result.changes > 0;
}

function deleteContact(id, clientWhatsappNumber) {
    const db = getUserDb(clientWhatsappNumber);
    const stmt = db.prepare('DELETE FROM contatos WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
}

module.exports = { 
    findUserByUsername, 
    findUserById, 
    getAllUsers,
    createUser, 
    updateUserWhatsappNumber,
    findUserByWhatsappNumber,
    getUserDb,
    saveSheetToDatabase,
    listImportedTables,
    getImportedSheetData,
    logCampaignSend, 
    getStats,
    saveOrUpdateContact,
    checkRecentSend,
    getFilteredContacts,
    updateContact,
    deleteContact,
    closeAllConnections,
    updateUserDelay, // ✅ Adicione esta linha se estiver faltando
    getUserDelay // (opcionalmente útil junto)
};
