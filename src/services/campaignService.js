// src/services/campaignService.js
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const whatsAppService = require('./whatsappService');
const dbService = require('./databaseService');
const mapeamentoConfig = require('../config/mapeamento');

const userDirBase = path.join(__dirname, '..', '..', 'user');
const campaignsInProgress = new Set();

// --- Funções Auxiliares ---

function normalizarTelefone(telefone) {
    let clean = String(telefone).replace(/\D/g, '');
    if (clean.length === 9 && clean.startsWith('9')) {
        return clean.substring(1);
    }
    return clean;
}

function formatarData(data) {
    if (!data) return '';
    if (typeof data === 'number') {
        const date_info = XLSX.SSF.parse_date_code(data);
        const mes = String(date_info.m).padStart(2, '0');
        const dia = String(date_info.d).padStart(2, '0');
        const ano = date_info.y;
        return `${dia}/${mes}/${ano}`;
    }
    const partes = String(data).split(/[\/\-\.]/);
    if (partes.length === 3) {
        let [p1, p2, p3] = partes;
        if (p3.length === 4) return `${p1.padStart(2, '0')}/${p2.padStart(2, '0')}/${p3}`;
    }
    return data;
}

function ensureUserDirectoryExists(clientId) {
    const specificUserDir = path.join(userDirBase, clientId);
    if (!fs.existsSync(specificUserDir)) {
        fs.mkdirSync(specificUserDir, { recursive: true });
    }
}

function formatarNumeroCompleto(numero) {
    if (!numero) return null;
    let clean = String(numero).replace(/\D/g, '');

    if (clean.startsWith('55') && (clean.length === 12 || clean.length === 13)) {
        return clean; // Já está no formato correto
    }
    if (clean.length === 10 || clean.length === 11) {
        return `55${clean}`; // Adiciona o código do país
    }
    return null; // Formato inválido
}


// --- Função Principal da Campanha ---

async function startCampaign({ campaignId, username, start, end, message, listFileName, tableName }, { socket, commandMessage }) {
    const clientWhatsappNumber = campaignId || (socket && socket.user ? socket.user.commandWhatsappNumber : null);
    const clientUsername = username || (socket && socket.user ? socket.user.username : null);

    const reply = (msg) => {
        if (commandMessage) commandMessage.reply(msg);
        if (socket) socket.emit('log', msg);
    };

    if (!clientWhatsappNumber || !clientUsername) {
        return reply('❌ Erro: Informações do cliente não identificadas para a campanha.');
    }
    if (campaignsInProgress.has(clientWhatsappNumber)) {
        return reply('🟡 Atenção: Uma campanha já está em andamento.');
    }

    const client = whatsAppService.getClient(clientUsername);
    
    if (!client || !client.info || !client.pupPage) {
        return reply('❌ Erro: A sessão do WhatsApp ainda está a inicializar ou não está pronta. Por favor, aguarde a mensagem "Conectado com sucesso" e tente novamente em alguns segundos.');
    }

    ensureUserDirectoryExists(clientWhatsappNumber);

    let dadosPlanilha = [];
    let headers = [];

    if (tableName) {
        dadosPlanilha = dbService.getImportedSheetData(clientWhatsappNumber, tableName);
        if (!dadosPlanilha || dadosPlanilha.length === 0) {
            return reply('❌ Erro: A lista selecionada está vazia.');
        }
        headers = Object.keys(dadosPlanilha[0]).map(h => String(h).toLowerCase().trim());
    } else {
        const listPath = path.join(userDirBase, clientWhatsappNumber, listFileName);
        if (!fs.existsSync(listPath)) {
            return reply(`❌ Erro: Planilha '${listFileName}' não encontrada.`);
        }
        const workbook = XLSX.readFile(listPath);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: "" });
        if (jsonData.length < 2) return reply('❌ Erro: A planilha está vazia.');
        headers = jsonData[0].map(h => String(h).toLowerCase().trim());
        dadosPlanilha = jsonData.slice(1).map(row => {
            const obj = {};
            headers.forEach((h, idx) => { obj[h] = row[idx]; });
            return obj;
        });
    }

    const campaignStats = { totalProcessed: 0, successfulSends: 0, ignoredRecent: 0, noWhatsapp: 0, failedToSend: 0, noContactInfo: 0 };

    try {
        campaignsInProgress.add(clientWhatsappNumber);
        reply('▶️ Iniciando processo de envio...');

        const mapeamento = {};
        for (const key in mapeamentoConfig) {
            mapeamento[key] = mapeamentoConfig[key].find(alias => headers.includes(alias)) || null;
        }
        if (!mapeamento.cpf) return reply("❌ Erro: A planilha precisa ter uma coluna para 'CPF'.");
        const dadosFiltrados = dadosPlanilha.map(item => ({
            NOME: String(item[mapeamento.nome] || ""),
            CPF: String(item[mapeamento.cpf] || "").replace(/\D/g, ''),
            AGENCIA: String(item[mapeamento.agencia] || ""),
            NASCIMENTO: formatarData(item[mapeamento.nascimento] || ""),
            DDD_01: String(item[mapeamento.ddd_01] || "").replace(/\D/g, ''),
            TEL_01: normalizarTelefone(item[mapeamento.tel_01] || ""),
            DDD_02: String(item[mapeamento.ddd_02] || "").replace(/\D/g, ''),
            TEL_02: normalizarTelefone(item[mapeamento.tel_02] || ""),
            DDD_03: String(item[mapeamento.ddd_03] || "").replace(/\D/g, ''),
            TEL_03: normalizarTelefone(item[mapeamento.tel_03] || ""),
            TELEFONE_1: String(item[mapeamento.telefone_1] || "").replace(/\D/g, ''),
            TELEFONE_2: String(item[mapeamento.telefone_2] || "").replace(/\D/g, ''),
            TELEFONE_3: String(item[mapeamento.telefone_3] || "").replace(/\D/g, ''),
        }));

        const rangeEnd = Math.min(end, dadosFiltrados.length);

        for (let i = start - 1; i < rangeEnd; i++) {
            campaignStats.totalProcessed++;
            const dados = dadosFiltrados[i];
            const nomeCompleto = dados.NOME || 'Cliente';
            
            let enviadoComSucesso = false;
            let contatoIgnorado = false;

            const numerosParaTentar = [];
            for (let j = 1; j <= 3; j++) {
                let numeroFinal = null;
                if (dados[`DDD_0${j}`] && dados[`TEL_0${j}`]) {
                    numeroFinal = `55${dados[`DDD_0${j}`]}${dados[`TEL_0${j}`]}`;
                } else if (dados[`TELEFONE_${j}`]) {
                    numeroFinal = formatarNumeroCompleto(dados[`TELEFONE_${j}`]);
                }
                if (numeroFinal) numerosParaTentar.push(numeroFinal);
            }
            const unicosParaTentar = [...new Set(numerosParaTentar)];

            if (unicosParaTentar.length === 0) {
                campaignStats.noContactInfo++;
                reply(`🚫 Contato ${nomeCompleto} ignorado (sem número de telefone válido).`);
                continue;
            }

            for (const numero of unicosParaTentar) {
                if (dbService.checkRecentSend(numero, clientWhatsappNumber)) {
                    contatoIgnorado = true;
                    break; 
                }
            }

            if (contatoIgnorado) {
                reply(`🟡 Envio para ${nomeCompleto} ignorado (contato recente).`);
                campaignStats.ignoredRecent++;
                continue;
            }
            
            // --- LÓGICA REVERTIDA: Envia apenas para o primeiro número válido ---
            for (const numero of unicosParaTentar) {
                try {
                    if (await client.isRegisteredUser(`${numero}@c.us`)) {
                        reply(`✅ Enviando para ${nomeCompleto} (${numero})...`);
                        let textoFinal = message.replace(/@nomecompleto/gi, nomeCompleto).replace(/@nome/gi, nomeCompleto.split(' ')[0]).replace(/@cpf/gi, dados.CPF).replace(/@agencia/gi, dados.AGENCIA);
                        
                        let imagePath = '';
                        const imageExtensions = ['jpeg', 'jpg', 'png', 'gif', 'webp'];
                        for (const ext of imageExtensions) {
                            const tempPath = path.join(userDirBase, clientWhatsappNumber, `imagem.${ext}`);
                            if (fs.existsSync(tempPath)) {
                                imagePath = tempPath;
                                break;
                            }
                        }

                        const audioPath = path.join(userDirBase, clientWhatsappNumber, 'audio.ogg');
                        const audioExists = fs.existsSync(audioPath);

                        if (imagePath) {
                            const imageMedia = MessageMedia.fromFilePath(imagePath);
                            await client.sendMessage(`${numero}@c.us`, imageMedia, { caption: textoFinal });
                        } else {
                            await client.sendMessage(`${numero}@c.us`, textoFinal);
                        }
                        if (audioExists) {
                            const audioMedia = MessageMedia.fromFilePath(audioPath);
                            await client.sendMessage(`${numero}@c.us`, audioMedia, { sendAudioAsVoice: true });
                        }
                        
                        dbService.saveOrUpdateContact({ cpf: dados.CPF, nome: dados.NOME, agencia: dados.AGENCIA, telefone: numero, nascimento: dados.NASCIMENTO }, clientWhatsappNumber);
                        dbService.logCampaignSend(clientWhatsappNumber, dados.CPF, 'SENT');
                        
                        enviadoComSucesso = true;
                        
                        await client.archiveChat(`${numero}@c.us`);
                        break; // <-- Pára o loop após o primeiro envio bem-sucedido
                    }
                } catch (e) {
                    console.error(`Erro ao tentar enviar para ${numero}:`, e);
                    reply(`❌ Falha ao enviar para ${nomeCompleto} (${numero}).`);
                    campaignStats.failedToSend++;
                }
            }

            if (enviadoComSucesso) {
                campaignStats.successfulSends++;
            } else {
                campaignStats.noWhatsapp++;
                dbService.logCampaignSend(clientWhatsappNumber, dados.CPF, 'NO_WHATSAPP');
                reply(`⭕ Nenhum número de ${nomeCompleto} encontrado no WhatsApp.`);
            }
            // --- FIM DA REVERSÃO ---
            
            await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
        }
    } catch (error) {
        console.error("Erro fatal durante a campanha:", error);
        reply('❌ Um erro inesperado ocorreu durante a campanha.');
    } finally {
        const summary = `🏁 *Campanha Finalizada!* 🏁\n- *Numero de clientes:* ${campaignStats.totalProcessed}\n- *✅ Contatos Alcançados:* ${campaignStats.successfulSends}\n- *⭕ Contatos Sem WhatsApp:* ${campaignStats.noWhatsapp}\n- *🟡 Ignorados (Recentes):* ${campaignStats.ignoredRecent}\n\n---------------------------------`;
        reply(summary);
        campaignsInProgress.delete(clientWhatsappNumber);
        if (socket) socket.emit('campaign-finished');
    }
}

module.exports = {
    startCampaign
};
