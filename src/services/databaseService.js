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
            command_whatsapp_number TEXT UNIQUE
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
        console.log(`Diretório de banco de dados criado para o cliente: ${clientWhatsappNumber}`);
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
 * Fecha todas as conexões de banco de dados abertas.
 * Ideal para ser chamado no encerramento do aplicativo.
 */
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

/**
 * Verifica se um NÚMERO DE TELEFONE específico recebeu uma mensagem recentemente.
 * @param {string} telefone - O número de telefone a ser verificado.
 * @param {string} clientWhatsappNumber - O ID do cliente que está a fazer a campanha.
 * @returns {boolean} - True se o envio foi recente, false caso contrário.
 */
function checkRecentSend(telefone, clientWhatsappNumber) {
    const db = getUserDb(clientWhatsappNumber);
    // A consulta agora verifica o campo 'telefone' em vez de 'cpf'
    const contact = db.prepare('SELECT data_envio_ultima_mensagem FROM contatos WHERE telefone = ?').get(telefone);
    
    if (!contact || !contact.data_envio_ultima_mensagem) {
        return false; // Se o número não foi encontrado ou nunca teve um envio, não é recente.
    }

    const lastSendDate = new Date(contact.data_envio_ultima_mensagem);
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // Retorna true se a data do último envio para este NÚMERO for dentro dos últimos 90 dias.
    return lastSendDate > ninetyDaysAgo;
}


function getFilteredContacts(clientWhatsappNumber, filter = 'default', searchTerm = '') {
    const db = getUserDb(clientWhatsappNumber);
    let baseQuery = 'SELECT * FROM contatos WHERE 1=1';
    const params = [];

    if (searchTerm) {
        const normalizedSearchTerm = searchTerm.replace(/\D/g, '');
        baseQuery += ' AND (nome LIKE ? OR cpf LIKE ? OR telefone LIKE ? OR nascimento LIKE ?)';
        params.push(`%${searchTerm}%`, `%${normalizedSearchTerm}%`, `%${normalizedSearchTerm}%`, `%${searchTerm}%`);
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

module.exports = { 
    // Funções de Autenticação
    findUserByUsername, 
    findUserById, 
    getAllUsers,
    createUser, 
    updateUserWhatsappNumber,
    findUserByWhatsappNumber,
    
    // Funções de Dados do Cliente
    getUserDb,
    logCampaignSend, 
    getStats,
    saveOrUpdateContact,
    checkRecentSend, // A função agora verifica por telefone
    getFilteredContacts,

    // Gestão de Conexões
    closeAllConnections
};
