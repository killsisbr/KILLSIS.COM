document.addEventListener('DOMContentLoaded', async () => {
    lucide.createIcons(); // Ativa os ícones
    const token = localStorage.getItem('jwt_token');
    if (!token) {
        window.location.href = '/login.html';
        return;
    }

    // --- Navegação ---
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('.page-section');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').substring(1);
            
            sections.forEach(sec => sec.classList.add('hidden'));
            document.getElementById(targetId).classList.remove('hidden');

            navLinks.forEach(l => l.classList.remove('active-link'));
            link.classList.add('active-link');
        });
    });

    // --- Lógica de Logout ---
    document.getElementById('logout-btn').addEventListener('click', () => {
        localStorage.removeItem('jwt_token');
        window.location.href = '/login.html';
    });

    // --- Carregar Estatísticas ---
    async function loadStats() {
        try {
            const res = await fetch('/api/stats', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Falha ao carregar estatísticas.');
            
            const stats = await res.json();
            const sent = stats.find(s => s.status === 'SENT')?.count || 0;
            const no_whatsapp = stats.find(s => s.status === 'NO_WHATSAPP')?.count || 0;
            const failed = stats.find(s => s.status === 'FAILED')?.count || 0;

            document.getElementById('stats-sent').textContent = sent;
            document.getElementById('stats-no-whatsapp').textContent = no_whatsapp;
            document.getElementById('stats-failed').textContent = failed;

            // --- Configuração do Gráfico ---
            const ctx = document.getElementById('campaignChart').getContext('2d');
            new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Enviados', 'Sem WhatsApp', 'Falhas'],
                    datasets: [{
                        data: [sent, no_whatsapp, failed],
                        backgroundColor: ['#10B981', '#F59E0B', '#EF4444'],
                        borderColor: '#1F2937',
                        borderWidth: 4,
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { color: '#D1D5DB' }
                        }
                    }
                }
            });

        } catch (error) {
            console.error(error);
        }
    }

    loadStats();
    
    // Conectar ao Socket.IO para a funcionalidade do WhatsApp
    const socket = io({ auth: { token } });
    // ... adicione a lógica de socket para a aba "WhatsApp" aqui ...
});
