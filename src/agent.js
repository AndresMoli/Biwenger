import fs from 'fs';
import path from 'path';

const {
  DATA_PATH,
  REPORT_PATH,
  REPORT_JSON_PATH,
  REPORT_NEWS_LIMIT
} = process.env;

const DEFAULT_DATA_PATH = path.resolve('public/data.json');
const DEFAULT_REPORT_PATH = path.resolve('public/reporte.txt');
const DEFAULT_REPORT_JSON_PATH = path.resolve('public/reporte.json');
const NEWS_LIMIT = Number(REPORT_NEWS_LIMIT || 6);

const SOURCES = [
  {
    name: 'Marca',
    url: 'https://e00-marca.uecdn.es/rss/futbol/primera-division.xml'
  },
  {
    name: 'AS',
    url: 'https://as.com/rss/tags/futbol.xml'
  },
  {
    name: 'Mundo Deportivo',
    url: 'https://www.mundodeportivo.com/rss/futbol/laliga.xml'
  },
  {
    name: 'Transfermarkt',
    url: 'https://www.transfermarkt.es/rss/transfermarkt.xml'
  },
  {
    name: 'LaLiga',
    url: 'https://www.laliga.com/rss'
  }
];

const alertKeywords = [
  'lesión',
  'lesion',
  'baja',
  'sanción',
  'sancion',
  'duda',
  'rotación',
  'rotacion'
];

const toNumber = (value) => {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const formatMoney = (value) => {
  if (value == null) return 'n/d';
  return `${new Intl.NumberFormat('es-ES').format(value)} €`;
};

const readJson = (filePath) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`No existe el archivo ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
};

const parseRssItems = (xml, source) => {
  const items = [];
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  const titleRegex = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/i;
  const linkRegex = /<link>([\s\S]*?)<\/link>/i;
  const dateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/i;
  const matches = xml.match(itemRegex) || [];
  for (const chunk of matches) {
    const titleMatch = chunk.match(titleRegex);
    const linkMatch = chunk.match(linkRegex);
    const dateMatch = chunk.match(dateRegex);
    const title = (titleMatch?.[1] || titleMatch?.[2] || '').trim();
    if (!title) continue;
    items.push({
      source,
      title,
      link: (linkMatch?.[1] || '').trim(),
      pubDate: (dateMatch?.[1] || '').trim()
    });
  }
  return items;
};

const fetchNews = async () => {
  const news = [];
  await Promise.all(SOURCES.map(async (source) => {
    try {
      const res = await fetch(source.url);
      if (!res.ok) return;
      const text = await res.text();
      news.push(...parseRssItems(text, source.name));
    } catch {
      // no detener el flujo si falla una fuente
    }
  }));
  return news;
};

const normalize = (value) => String(value || '').toLowerCase();

const scoreBargain = (player) => {
  const price = toNumber(player.price);
  const clause = toNumber(player.clause);
  if (!price || !clause || clause <= price) return null;
  return (clause - price) / price;
};

const pickTopByPrice = (players, limit = 1) => {
  const sorted = [...players].sort((a, b) => (b.price || 0) - (a.price || 0));
  return sorted.slice(0, limit);
};

const byPosition = (players) => {
  return players.reduce((acc, player) => {
    const pos = player.position || 'OTR';
    acc[pos] = acc[pos] || [];
    acc[pos].push(player);
    return acc;
  }, {});
};

const formatPlayer = (player) => {
  const parts = [player.name];
  if (player.team) parts.push(player.team);
  if (player.position) parts.push(player.position);
  parts.push(formatMoney(player.price));
  return parts.filter(Boolean).join(' · ');
};

const pickLineup = (teamPlayers) => {
  const grouped = byPosition(teamPlayers);
  const defenders = pickTopByPrice(grouped.DEF || [], 3);
  const midfielders = pickTopByPrice(grouped.MED || [], 4);
  const forwards = pickTopByPrice(grouped.DEL || [], 3);
  const goalkeepers = pickTopByPrice(grouped.POR || [], 1);
  const formation = `${defenders.length}-${midfielders.length}-${forwards.length}`;
  return { goalkeepers, defenders, midfielders, forwards, formation };
};

const buildReport = async (data) => {
  const allPlayers = [...(data.team || []), ...(data.market || [])];
  const team = data.team || [];
  const market = data.market || [];
  const balance = toNumber(data.balance);
  const news = await fetchNews();

  const topPlayer = pickTopByPrice(allPlayers, 1)[0];
  const topMarket = pickTopByPrice(market, 5);

  const bargains = market
    .map(player => ({ player, score: scoreBargain(player) }))
    .filter(item => item.score != null)
    .sort((a, b) => b.score - a.score);
  const bestBargain = bargains[0]?.player;

  const teamSorted = pickTopByPrice(team, team.length);
  const recommendedSell = teamSorted.slice(-3).reverse();

  const affordable = balance != null
    ? market.filter(player => toNumber(player.price) != null && player.price <= balance)
    : [];

  const lineup = pickLineup(team);

  const normalizedTitles = news.map(item => ({
    ...item,
    titleLower: normalize(item.title)
  }));

  const alerts = [];
  for (const player of team) {
    const playerName = normalize(player.name);
    if (!playerName) continue;
    const alertNews = normalizedTitles.find(item =>
      item.titleLower.includes(playerName) &&
      alertKeywords.some(keyword => item.titleLower.includes(keyword))
    );
    if (alertNews) {
      alerts.push({
        player,
        headline: alertNews.title,
        source: alertNews.source
      });
    }
  }

  const newsSummary = news.slice(0, NEWS_LIMIT);

  const reportLines = [];
  reportLines.push('📰 Noticias clave');
  if (newsSummary.length) {
    newsSummary.forEach(item => {
      reportLines.push(`• [${item.source}] ${item.title}${item.link ? ` (${item.link})` : ''}`);
    });
  } else {
    reportLines.push('• No se han podido recuperar titulares en este momento.');
  }

  reportLines.push('');
  reportLines.push('⭐ Jugador TOP del momento');
  reportLines.push(topPlayer ? `• ${formatPlayer(topPlayer)}` : '• Sin datos suficientes.');

  reportLines.push('');
  reportLines.push('💰 Apuesta económica');
  reportLines.push(bestBargain ? `• ${formatPlayer(bestBargain)}` : '• Sin gangas detectadas con los datos actuales.');

  reportLines.push('');
  reportLines.push('⚠ Alertas (lesiones, sanciones, rotaciones)');
  if (alerts.length) {
    alerts.forEach(item => {
      reportLines.push(`• ${item.player.name}: ${item.headline} (${item.source})`);
    });
  } else {
    reportLines.push('• Ninguna alerta relevante detectada en titulares recientes.');
  }

  reportLines.push('');
  reportLines.push('📊 Recomendación táctica para la próxima jornada');
  reportLines.push(`• Formación sugerida con defensa de 3: ${lineup.formation || '3-x-x'}`);
  reportLines.push(`• Portero: ${lineup.goalkeepers.map(formatPlayer).join(' | ') || 'n/d'}`);
  reportLines.push(`• Defensas: ${lineup.defenders.map(formatPlayer).join(' | ') || 'n/d'}`);
  reportLines.push(`• Medios: ${lineup.midfielders.map(formatPlayer).join(' | ') || 'n/d'}`);
  reportLines.push(`• Delanteros: ${lineup.forwards.map(formatPlayer).join(' | ') || 'n/d'}`);
  reportLines.push('');
  reportLines.push('🎯 Recomendaciones de compra/venta');
  reportLines.push('• Compras sugeridas:');
  if (bargains.length) {
    bargains.slice(0, 3).forEach(item => {
      reportLines.push(`  - ${formatPlayer(item.player)} (valor +${Math.round(item.score * 100)}%)`);
    });
  } else {
    reportLines.push('  - Sin oportunidades claras por cláusula/precio.');
  }
  reportLines.push('• Ventas sugeridas:');
  if (recommendedSell.length) {
    recommendedSell.forEach(player => {
      reportLines.push(`  - ${formatPlayer(player)} (liberar presupuesto)`);
    });
  } else {
    reportLines.push('  - Sin datos de plantilla suficientes.');
  }

  reportLines.push('');
  reportLines.push('💼 Oportunidades de mercado según presupuesto');
  if (balance == null) {
    reportLines.push('• Saldo no disponible.');
  } else if (!affordable.length) {
    reportLines.push(`• Con un saldo de ${formatMoney(balance)} no hay jugadores del mercado en rango.`);
  } else {
    reportLines.push(`• Saldo disponible: ${formatMoney(balance)}`);
    affordable.slice(0, 5).forEach(player => {
      reportLines.push(`  - ${formatPlayer(player)}`);
    });
  }

  reportLines.push('');
  reportLines.push('⚙️ Nota del analista');
  reportLines.push('• Mantengo la defensa de 3 para maximizar puntos en mediocampo y ataque, ajustando según el mercado.');

  const reportText = reportLines.join('\n');
  const reportJson = {
    generatedAt: new Date().toISOString(),
    leagueId: data.leagueId || null,
    balance: balance ?? null,
    topPlayer: topPlayer || null,
    bestBargain: bestBargain || null,
    lineup,
    recommendedBuys: bargains.slice(0, 3).map(item => item.player),
    recommendedSells: recommendedSell,
    alerts,
    news: newsSummary
  };

  return { reportText, reportJson };
};

const ensureDir = (filePath) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const main = async () => {
  try {
    const data = readJson(DATA_PATH || DEFAULT_DATA_PATH);
    const { reportText, reportJson } = await buildReport(data);
    const reportPath = REPORT_PATH || DEFAULT_REPORT_PATH;
    const reportJsonPath = REPORT_JSON_PATH || DEFAULT_REPORT_JSON_PATH;
    ensureDir(reportPath);
    ensureDir(reportJsonPath);
    fs.writeFileSync(reportPath, reportText);
    fs.writeFileSync(reportJsonPath, JSON.stringify(reportJson, null, 2));
    console.log(reportText);
  } catch (error) {
    console.error('Error generando el informe:', error?.message || error);
    process.exit(1);
  }
};

main();
