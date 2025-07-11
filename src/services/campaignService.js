// src/services/campaignService.js
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const whatsAppService = require('./whatsappService');
const dbService = require('./databaseService');
const mapeamentoConfig = require('../config/mapeamento');

// Diretório base para dados do usuário
const userDirBase = path.join(__dirname, '..', '..', 'user');

// Controle para evitar campanhas simultâneas para o mesmo cliente
const campaignsInProgress = new Set();

// --- Funções Auxiliares ---

function normalizarTelefone(telefone) {
    telefone = telefone.replace(/\D/g, '');
    while (telefone.length > 8) {
        telefone = telefone.substring(1);
    }
    return telefone;
}


function formatarData(data) {
    if (!data) return '';
    if (typeof data === 'number') {
        const date_info = XLSX.SSF.parse_date_code(data);
        const mes = String(date_info.d).padStart(2, '0');
        const dia = String(date_info.m).padStart(2, '0');
        const ano = date_info.y;
        return `${dia}/${mes}/${ano}`;
    }
    const partes = String(data).split(/[\/\-\.]/);
    if (partes.length === 3) {
        let [p1, p2, p3] = partes;
        if (p3.length === 4) {
            return `${p1.padStart(2, '0')}/${p2.padStart(2, '0')}/${p3}`;
        }
    }
    return data;
}

function ensureUserDirectoryExists(clientId) {
    const specificUserDir = path.join(userDirBase, clientId);
    if (!fs.existsSync(specificUserDir)) {
        fs.mkdirSync(specificUserDir, { recursive: true });
    }
}


// --- Função Principal da Campanha ---

async function startCampaign({ campaignId, username, start, end, message, listFileName, useAI }, { socket, commandMessage }) {
    const clientWhatsappNumber = campaignId || (socket && socket.user ? socket.user.commandWhatsappNumber : null);
    const clientUsername = username || (socket && socket.user ? socket.user.username : null);

    const reply = (msg) => {
        if (commandMessage) commandMessage.reply(msg);
        if (socket) socket.emit('log', msg);
    };

    if (!clientWhatsappNumber) {
        return reply('❌ Erro: Número de WhatsApp do cliente não identificado para a campanha.');
    }
    if (!clientUsername) {
        return reply('❌ Erro: Nome de usuário não identificado para a campanha.');
    }
    if (campaignsInProgress.has(clientWhatsappNumber)) {
        return reply('🟡 Atenção: Uma campanha já está em andamento. Por favor, aguarde a finalização.');
    }

    const client = whatsAppService.getClient(clientUsername);
    if (!client) {
        return reply('❌ Erro: Cliente WhatsApp não encontrado ou não iniciado.');
    }

    const state = await client.getState();
    if (state !== 'CONNECTED') {
        return reply('❌ Erro: Cliente não está conectado. Vá para a aba WhatsApp e escaneie o QR Code.');
    }

    ensureUserDirectoryExists(clientWhatsappNumber);
    const listPath = path.join(userDirBase, clientWhatsappNumber, listFileName);
    if (!fs.existsSync(listPath)) {
        return reply(`❌ Erro: Planilha '${listFileName}' não foi encontrada no servidor.`);
    }

    const campaignStats = {
        totalProcessed: 0, successfulSends: 0, ignoredRecent: 0,
        ignoredNoCpf: 0, noWhatsapp: 0, failedToSend: 0, noContactInfo: 0
    };

    try {
        campaignsInProgress.add(clientWhatsappNumber);
        reply('▶️ Iniciando processo de envio...');

        const workbook = XLSX.readFile(listPath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: "" });

        if (jsonData.length < 2) {
            return reply('❌ Erro: A planilha está vazia ou não contém dados.');
        }
        const headers = jsonData[0].map(h => String(h).toLowerCase().trim());
        const dadosPlanilha = jsonData.slice(1);

        const mapeamento = {};
        for (const key in mapeamentoConfig) {
            const foundHeader = mapeamentoConfig[key].find(alias => headers.includes(alias));
            if (foundHeader) {
                mapeamento[key] = foundHeader;
            } else if (key === 'cpf') {
                return reply("❌ Erro: A planilha precisa ter uma coluna para 'CPF'.");
            } else {
                mapeamento[key] = null;
            }
        }

        const dadosFiltrados = dadosPlanilha.map(item => ({
            NOME: String(item[headers.indexOf(mapeamento.nome)] || ""),
            CPF: String(item[headers.indexOf(mapeamento.cpf)] || "").replace(/\D/g, ''),
            AGENCIA: String(item[headers.indexOf(mapeamento.agencia)] || ""),
            NASCIMENTO: formatarData(item[headers.indexOf(mapeamento.nascimento)] || ""),
            DDD_01: String(item[headers.indexOf(mapeamento.ddd_01)] || "").replace(/\D/g, ''),
            TEL_01: normalizarTelefone(String(item[headers.indexOf(mapeamento.tel_01)] || "")),
            DDD_02: String(item[headers.indexOf(mapeamento.ddd_02)] || "").replace(/\D/g, ''),
            TEL_02: normalizarTelefone(String(item[headers.indexOf(mapeamento.tel_02)] || "")),
            DDD_03: String(item[headers.indexOf(mapeamento.ddd_03)] || "").replace(/\D/g, ''),
            TEL_03: normalizarTelefone(String(item[headers.indexOf(mapeamento.tel_03)] || "")),
        }));

        const rangeEnd = Math.min(end, dadosFiltrados.length);

        for (let i = start - 1; i < rangeEnd; i++) {
            campaignStats.totalProcessed++;
            const dados = dadosFiltrados[i];
            const nomeCompleto = dados.NOME || 'Cliente';
            let enviadoComSucesso = false;

            if (!dados.CPF) {
                campaignStats.ignoredNoCpf++;
                continue;
            }

            const numerosParaTentar = [
                dados.DDD_01 && dados.TEL_01 ? `55${dados.DDD_01}${dados.TEL_01}` : null,
                dados.DDD_02 && dados.TEL_02 ? `55${dados.DDD_02}${dados.TEL_02}` : null,
                dados.DDD_03 && dados.TEL_03 ? `55${dados.DDD_03}${dados.TEL_03}` : null,
            ].filter(n => n && n.length >= 12);

            if (numerosParaTentar.length === 0) {
                campaignStats.noContactInfo++;
            } else {
                let ignore = 0;
                for (const numero of numerosParaTentar) {
                    // *** CORREÇÃO LÓGICA ***
                    // A verificação de envio recente agora é feita por numero
                    // antes de tentar qualquer um dos seus números.
                    if (dbService.checkRecentSend(numero, clientWhatsappNumber)) {

                        if (ignore === 0) {
                            reply(`🟡 Ignorado (envio recente): ${nomeCompleto}`);
                            ignore = 1;
                        }
                        campaignStats.ignoredRecent++;
                        continue; // Pula para o próximo contato da planilha.
                    }

                    const numeroComWhatsapp = `${numero}@c.us`;
                    try {
                        const isRegistered = await client.isRegisteredUser(numeroComWhatsapp);
                        if (isRegistered) {
                            let textoFinal = message
                                .replace(/@nomecompleto/gi, nomeCompleto)
                                .replace(/@nome/gi, nomeCompleto.split(' ')[0])
                                .replace(/@cpf/gi, dados.CPF)
                                .replace(/@agencia/gi, dados.AGENCIA);

                            const imagePath = path.join(userDirBase, clientWhatsappNumber, 'imagem.jpeg');
                            const audioPath = path.join(userDirBase, clientWhatsappNumber, 'audio.ogg');
                            let mediaToSend = null;

                            if (fs.existsSync(imagePath)) {
                                mediaToSend = MessageMedia.fromFilePath(imagePath);
                            } else if (fs.existsSync(audioPath)) {
                                mediaToSend = MessageMedia.fromFilePath(audioPath);
                            }

                            if (mediaToSend) {
                                const isAudio = path.extname(mediaToSend.filename).toLowerCase() === '.ogg';

                                if (isAudio) {
                                    // Envia texto separado antes do áudio
                                    await client.sendMessage(numeroComWhatsapp, textoFinal);
                                    await new Promise(resolve => setTimeout(resolve, 500)); // pequeno delay
                                    await client.sendMessage(numeroComWhatsapp, mediaToSend);
                                } else {
                                    // Para imagem, legenda funciona
                                    await client.sendMessage(numeroComWhatsapp, mediaToSend, { caption: textoFinal });
                                }
                            } else {
                                await client.sendMessage(numeroComWhatsapp, textoFinal);
                            }


                            dbService.saveOrUpdateContact({
                                cpf: dados.CPF, nome: dados.NOME, agencia: dados.AGENCIA,
                                telefone: numero, // Salva o número que funcionou
                                nascimento: dados.NASCIMENTO
                            }, clientWhatsappNumber);
                            dbService.logCampaignSend(clientWhatsappNumber, dados.CPF, 'SENT');

                            enviadoComSucesso = true;
                            break;
                        } else {
                            dbService.logCampaignSend(clientWhatsappNumber, dados.CPF, 'NO_WHATSAPP');
                            campaignStats.noWhatsapp++;
                        }
                    } catch (e) {
                        dbService.logCampaignSend(clientWhatsappNumber, dados.CPF, 'FAILED');
                        campaignStats.failedToSend++;
                    }
                }
            }

            await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
        }
    } catch (error) {
        console.error("Erro fatal durante a campanha:", error);
        reply('❌ Um erro inesperado ocorreu durante a campanha. Verifique os logs do servidor.');
    } finally {
        const summary = `
        \n---------------------------------
        🏁 *Campanha Finalizada!* 🏁
        - *Total Processado:* ${campaignStats.totalProcessed}
        - *✅ Enviados com Sucesso:* ${campaignStats.successfulSends}
        - *⭕ Sem WhatsApp (Tentativas):* ${campaignStats.noWhatsapp}
        - *🚫 Sem Contato Válido:* ${campaignStats.noContactInfo}
        ---------------------------------`;

        reply(summary);

        campaignsInProgress.delete(clientWhatsappNumber);
        if (socket) socket.emit('campaign-finished');
    }
}

module.exports = {
    startCampaign
};
