// src/services/statsService.js

const db = require('./databaseService');

/**
 * Manipulador para a rota da API que busca estatísticas.
 * Ele pega o ID do cliente do token verificado, consulta o banco de dados
 * e retorna as estatísticas da campanha para esse cliente.
 * @param {object} req - O objeto de requisição do Express.
 * @param {object} res - O objeto de resposta do Express.
 */
async function getStatsHandler(req, res) {
    try {
        // CORREÇÃO: Usar o clientId do token em vez do userId
        const clientId = req.user.clientId;
        if (!clientId) {
            return res.status(400).json({ message: 'ID do cliente não encontrado no token.' });
        }

        const stats = db.getStats(clientId);
        res.json(stats);
    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        res.status(500).json({ message: 'Erro interno do servidor ao buscar estatísticas.' });
    }
}

module.exports = {
    getStatsHandler
};
