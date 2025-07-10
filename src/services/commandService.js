// src/services/commandService.js
const commands = require('../config/commands');
const fs = require('fs');
const path = require('path');
const { startCampaign } = require('./campaignService');
const dbService = require('./databaseService');
const XLSX = require('xlsx');
const { sanitizeIdentifier } = require('./whatsappService'); // Importar sanitizeIdentifier

const userDirBase = path.join(__dirname, '..', '..', 'user');

if (!fs.existsSync(userDirBase)) {
    fs.mkdirSync(userDirBase);
}

function ensureUserDirectoryExists(clientId) {
    const sanitizedClientId = sanitizeIdentifier(clientId); // Sanitizar o clientId
    const specificUserDir = path.join(userDirBase, sanitizedClientId);
    if (!fs.existsSync(specificUserDir)) {
        fs.mkdirSync(specificUserDir, { recursive: true });
    }
}

function atualizarTexto(idChat, texto, msg) {
    ensureUserDirectoryExists(idChat);
    const filePath = path.join(userDirBase, idChat, 'mensagem.json');
    fs.writeFile(filePath, JSON.stringify(texto, null, 2), (err) => {
        if (err) {
            console.error('Erro ao salvar o arquivo JSON:', err);
            msg.reply('❌ Erro ao salvar o texto da mensagem.');
        } else {
            msg.reply('✅ Texto da mensagem salvo com sucesso!');
        }
    });
}

/**
 * Manipula uma mensagem recebida para verificar se é um comando e executá-lo.
 * @param {object} message - O objeto da mensagem do whatsapp-web.js.
 * @param {object} user - O objeto do usuário do banco de dados que enviou o comando.
 * @param {string} clientId - O número de telefone do usuário (remetente).
 * @param {object} socket - O socket da web do usuário, se houver uma sessão ativa.
 * @param {string} centralBotWhatsappNumber - O número do bot central.
 */
async function handleCommand(message, user, clientId, socket, centralBotWhatsappNumber) {
    // A variável `clientId` agora é recebida diretamente como o número de telefone do remetente.

    if (message.hasMedia && !message.fromMe) {
        const media = await message.downloadMedia();
        let handled = false;
        if (media.mimetype === 'audio/ogg; codecs=opus') {
            handled = true;
            fs.writeFile(path.join(userDirBase, clientId, `audio.ogg`), media.data, 'base64', (err) => {
                if (err) console.error('Erro ao salvar o arquivo de áudio:', err);
                else message.reply('✅ Áudio para envio atualizado.');
            });
        } else if (media.mimetype.startsWith('image/')) {
            handled = true;
            const fileExtension = media.mimetype.split('/')[1];
            fs.writeFile(path.join(userDirBase, clientId, `imagem.${fileExtension}`), media.data, 'base64', (err) => {
                if (err) console.error('Erro ao salvar a imagem:', err);
                else message.reply('✅ Imagem salva para envio.');
            });
        } else if (media.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
            handled = true;
            fs.writeFile(path.join(userDirBase, clientId, `lista.xlsx`), media.data, 'base64', (err) => {
                if (err) console.error('Erro ao salvar a planilha:', err);
                else message.reply('✅ Planilha atualizada.');
            });
        }
        if (handled) return;
    }

    const content = message.body.trim().split(' ')[0];
    const command = commands.find(cmd => cmd.command === content);

    if (command) {
        console.log(`[+] Comando '${command.command}' recebido de ${message.from} para o usuário ${user.username}`);
        try {
            // Passa os argumentos na ordem correta, agora com `clientId` sendo a string do número de telefone.
            await command.action(
                message,
                user,
                clientId,
                socket,
                centralBotWhatsappNumber,
                userDirBase,
                atualizarTexto,
                startCampaign,
                dbService,
                XLSX
            );
        } catch (error) {
            console.error(`Erro ao executar o comando '${command.command}':`, error);
            message.reply(`❌ Ocorreu um erro ao executar o comando ${command.command}.`);
        }
    }
}

module.exports = {
    handleCommand,
};
