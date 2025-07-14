// server.js

// --- Módulos ---
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

// --- Serviços Internos ---
const authService = require('./src/services/authService');
const statsService = require('./src/services/statsService.js');
const whatsAppService = require('./src/services/whatsappService');
const campaignService = require('./src/services/campaignService');
const dbService = require('./src/services/databaseService');
const geminiAnalysisService = require('./src/services/geminiAnalysisService');
// --- Configuração ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 });
const PORT = process.env.PORT || 3000;

// --- Middlewares ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// --- Diretórios ---
const userDir = path.join(__dirname, 'user');
if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir);
}

// --- Rota Principal e de Login ---
app.use(express.json({ limit: '50mb' })); 
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// --- Rotas da API de Autenticação ---
app.post('/api/register', authService.registerHandler);
app.post('/api/login', authService.loginHandler);

// --- Rotas Protegidas da API ---
app.get('/api/user/me', authService.verifyToken, (req, res) => res.json(req.user));
app.get('/api/stats', authService.verifyToken, statsService.getStatsHandler);

app.get('/api/contacts', authService.verifyToken, (req, res) => {
    try {
        const clientId = req.user.clientId;
        const { filter, search } = req.query;

        if (!clientId) {
            return res.json([]);
        }

        const contacts = dbService.getFilteredContacts(clientId, filter, search);
        res.json(contacts);
    } catch (error) {
        console.error("Erro na rota /api/contacts:", error);
        res.status(500).json({ message: 'Erro ao buscar contatos.' });
    }
});

// --- NOVAS ROTAS PARA PLANILHAS IMPORTADAS ---
app.get('/api/imported-sheets', authService.verifyToken, (req, res) => {
    try {
        const clientId = req.user.clientId;
        if (!clientId) {
            return res.status(400).json({ message: 'Cliente não conectado ao WhatsApp.' });
        }
        const tables = dbService.listImportedTables(clientId);
        res.json(tables);
    } catch (error) {
        console.error("Erro ao listar tabelas importadas:", error);
        res.status(500).json({ message: 'Erro ao buscar listas importadas.' });
    }
});

app.get('/api/imported-sheets/:tableName', authService.verifyToken, (req, res) => {
    try {
        const clientId = req.user.clientId;
        const { tableName } = req.params;
        if (!clientId) {
            return res.status(400).json({ message: 'Cliente não conectado ao WhatsApp.' });
        }
        const data = dbService.getImportedSheetData(clientId, tableName);
        res.json(data);
    } catch (error) {
        console.error(`Erro ao buscar dados da tabela ${req.params.tableName}:`, error);
        res.status(500).json({ message: 'Erro ao buscar dados da lista.' });
    }
});
// --- FIM DAS NOVAS ROTAS ---


app.put('/api/contacts/:id', authService.verifyToken, (req, res) => {
    try {
        const { id } = req.params;
        const { nome } = req.body;
        const userId = req.user.id || req.user.userId;
        if (!userId) return res.status(403).json({ message: 'ID de usuário não encontrado no token.' });
        
        const freshUser = dbService.findUserById(userId);
        if (!freshUser || !freshUser.command_whatsapp_number) return res.status(400).json({ message: 'Cliente WhatsApp não associado.' });

        if (!nome || typeof nome !== 'string' || nome.trim() === '') return res.status(400).json({ message: 'O novo nome é obrigatório.' });

        const success = dbService.updateContact(id, { nome }, freshUser.command_whatsapp_number);
        if (success) {
            res.json({ message: 'Contato atualizado com sucesso.' });
        } else {
            res.status(404).json({ message: 'Contato não encontrado.' });
        }
    } catch (error) {
        console.error("Erro na rota PUT /api/contacts/:id:", error);
        res.status(500).json({ message: 'Erro ao atualizar contato.' });
    }
});

app.delete('/api/contacts/:id', authService.verifyToken, (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id || req.user.userId;
        if (!userId) return res.status(403).json({ message: 'ID de usuário não encontrado no token.' });

        const freshUser = dbService.findUserById(userId);
        if (!freshUser || !freshUser.command_whatsapp_number) return res.status(400).json({ message: 'Cliente WhatsApp não associado.' });

        const success = dbService.deleteContact(id, freshUser.command_whatsapp_number);
        if (success) {
            res.json({ message: 'Contato apagado com sucesso.' });
        } else {
            res.status(404).json({ message: 'Contato não encontrado.' });
        }
    } catch (error) {
        console.error("Erro na rota DELETE /api/contacts/:id:", error);
        res.status(500).json({ message: 'Erro ao apagar contato.' });
    }
});


// --- Lógica do Socket.IO com Autenticação ---
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Token de autenticação não fornecido."));
    
    jwt.verify(token, authService.JWT_SECRET, (err, user) => {
        if (err) return next(new Error("Token inválido."));
        socket.user = user;
        next();
    });
}).on('connection', (socket) => {
    console.log(`[+] Cliente autenticado e conectado: ${socket.user.username} (ClientID: ${socket.user.clientId})`);

    whatsAppService.initializeClient(socket.user.username, socket.user, socket, false);

    socket.on('upload-list', ({ id, file, fileName }) => {
        const clientUserDir = path.join(userDir, id);
        if (!fs.existsSync(clientUserDir)) fs.mkdirSync(clientUserDir);
        const filePath = path.join(clientUserDir, fileName);
        fs.writeFile(filePath, Buffer.from(file), (err) => {
            if (err) return socket.emit('log', `Erro ao guardar a lista: ${err.message}`);
            socket.emit('upload-success', { fileName });
        });
    });

    socket.on('upload-media', ({ id, file, type }) => {
        const mediaFileName = type.startsWith('image/') ? 'imagem.jpeg' : 'audio.ogg';
        const clientUserDir = path.join(userDir, id);
        if (!fs.existsSync(clientUserDir)) fs.mkdirSync(clientUserDir);
        const filePath = path.join(clientUserDir, mediaFileName);
        fs.writeFile(filePath, Buffer.from(file), (err) => {
            if (err) return socket.emit('log', `Erro ao guardar a mídia: ${err.message}`);
            socket.emit('upload-success', { fileName: mediaFileName });
        });
    });

    socket.on('start-sending', async (data) => {
        campaignService.startCampaign(data, { socket });
    });
});

function initializeUserSessionsOnStartup() {
    console.log('\n[+] Verificando sessões de usuário para inicialização automática...');
    try {
        const allUsers = dbService.getAllUsers();
        for (const user of allUsers) {
            if (user.command_whatsapp_number) {
                whatsAppService.initializeClient(user.username, user, null, false);
            }
        }
        console.log('[+] Verificação de sessões concluída.');
    } catch (error) {
        console.error('[-] Erro crítico ao inicializar sessões de usuário na inicialização:', error);
    }
}


// --- Iniciar Servidor ---
server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    whatsAppService.initializeClient('bot-central', null, null, true);
    initializeUserSessionsOnStartup();
});
