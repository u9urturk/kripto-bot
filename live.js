const WebSocket = require('ws');

// Binance Futures WebSocket URL
const BINANCE_FUTURES_WS = 'wss://fstream.binance.com/ws';

// Piyasa verilerini işleme
function processMarketData(data) {
    const parsedData = JSON.parse(data);

    if (parsedData.e === 'kline') {
        const kline = parsedData.k;
        console.log(`\n--- Piyasa Verisi ---`);
        console.log(`Sembol: ${parsedData.s}`);
        console.log(`Açılış Fiyatı: ${kline.o}`);
        console.log(`Kapanış Fiyatı: ${kline.c}`);
        console.log(`En Yüksek Fiyat: ${kline.h}`);
        console.log(`En Düşük Fiyat: ${kline.l}`);
        console.log(`Hacim: ${kline.v}`);
        console.log(`Kapanış Durumu: ${kline.x ? 'Kapandı' : 'Açık'}`);
        console.log(`Zaman: ${new Date(parsedData.E).toLocaleString()}`);

    }
}

// WebSocket bağlantısını başlatma
function connectMarketWebSocket() {
    const ws = new WebSocket(BINANCE_FUTURES_WS);

    ws.on('open', () => {
        console.log('Piyasa verisi için WebSocket bağlantısı kuruldu.');
        // WebSocket üzerinden abone olunan piyasa verileri
        ws.send(JSON.stringify({
            method: 'SUBSCRIBE',
            params: ['btcusdt@kline_1m'], // 1 dakikalık mum verisi için abone olma
            id: 1
        }));
    });

    ws.on('message', (data) => {
        try {
            processMarketData(data);
        } catch (error) {
            console.error('Piyasa verisi işleme hatası:', error);
        }
    });

    ws.on('close', () => {
        console.log('Piyasa verisi WebSocket bağlantısı kapatıldı. Yeniden bağlanılıyor...');
        setTimeout(connectMarketWebSocket, 5000);
    });

    ws.on('error', (error) => {
        console.error('Piyasa verisi WebSocket hatası:', error);
    });
}

// WebSocket bağlantısını başlat
connectMarketWebSocket();
