const fs = require('fs');
const axios = require('axios');
const WebSocket = require('ws');

const LEVERAGE = 10; // 10x kaldıraç
const ACCOUNT_BALANCE = 1000; // Örnek başlangıç bakiyesi
let accountBalance = ACCOUNT_BALANCE;

const ATR_PERIOD = 14; // ATR hesaplama için mum sayısı
const MULTIPLIER = 2; // Supertrend çarpanı
const BINANCE_FUTURES_WS = 'wss://fstream.binance.com/ws';

const MAX_POSITIONS = 3; // En fazla 3 pozisyon açılabilir
const TREND_CHANGE_THRESHOLD = 3; // Trend değişikliği için kontrol edilen mum sayısı
const TREND_CONTINUITY_THRESHOLD = 3; // Süreklilik için kontrol edilen mum sayısı

let positions = []; // Aktif pozisyonlar
let klineData = []; // Gelen Kline verileri
let atrValues = []; // ATR değerleri
let supertrend = {}; // Supertrend hesaplamaları
let ws; // WebSocket nesnesi

// Pozisyonları loglama
function logPosition(position) {
  const logMessage = `Tarih: ${new Date().toLocaleString()} | Pozisyon: ${position.direction} | Giriş Fiyatı: ${position.entryPrice} | Hedef: ${position.targetPrice} | Stop-Loss: ${position.stopLoss} | Sonuç: ${position.result || 'Açık'} | Kasa: ${accountBalance.toFixed(2)}\n`;
  fs.appendFileSync('pozisyonlar.log', logMessage);
}

// Trend sürekliliğini kontrol et
function checkTrendContinuity(currentTrend) {
  let consecutiveCount = 0;

  // Son 3 mum verisini kontrol et
  for (let i = klineData.length - 1; i >= 0 && consecutiveCount < TREND_CONTINUITY_THRESHOLD; i--) {
      const currentKline = klineData[i];
      
      if (currentTrend === 'up' && currentKline.close > currentKline.open) {
          consecutiveCount++;
      } else if (currentTrend === 'down' && currentKline.close < currentKline.open) {
          consecutiveCount++;
      } else {
          break;
      }
  }

  // Eğer trend belirli sayıda mum boyunca aynı yönde devam ettiyse, sinyali geçerli say
  return consecutiveCount >= TREND_CONTINUITY_THRESHOLD;
}

// Pozisyon açma
function openPosition(direction, entryPrice) {
  const positionSize = (accountBalance * LEVERAGE) / entryPrice;
  const targetPrice = direction === 'long' ? entryPrice * 1.01 : entryPrice * 0.99; // %1 hedef
  const stopLoss = direction === 'long' ? entryPrice * 0.99 : entryPrice * 1.01; // %1 zarar

  const position = {
    direction,
    entryPrice,
    targetPrice,
    stopLoss,
    status: 'open',
    size: positionSize,
    timestamp: Date.now()
  };

  positions.push(position);
  logPosition(position);
  console.log(`Pozisyon açıldı: ${direction} | Giriş: ${entryPrice} | Hedef: ${targetPrice} | Stop-Loss: ${stopLoss}`);
}

// Pozisyonları güncelleme
function updatePositions(currentPrice) {
  positions = positions.map(position => {
    if (position.status === 'open') {
      const { direction, targetPrice, stopLoss, size } = position;
      if ((direction === 'long' && currentPrice >= targetPrice) ||
        (direction === 'short' && currentPrice <= targetPrice)) {
        position.status = 'closed';
        position.result = 'TP';
        const profit = size * (Math.abs(targetPrice - position.entryPrice));
        accountBalance += profit;
        console.log(`Kar alındı (TP): ${currentPrice} | Kar: ${profit.toFixed(2)} | Yeni Kasa: ${accountBalance.toFixed(2)}`);
      } else if ((direction === 'long' && currentPrice <= stopLoss) ||
        (direction === 'short' && currentPrice >= stopLoss)) {
        position.status = 'closed';
        position.result = 'SL';
        const loss = size * (Math.abs(stopLoss - position.entryPrice));
        accountBalance -= loss;
        console.log(`Zararla kapandı (SL): ${currentPrice} | Zarar: ${loss.toFixed(2)} | Yeni Kasa: ${accountBalance.toFixed(2)}`);
      }
    }
    return position;
  });
}

// ATR hesaplama
function calculateATR() {
  const trValues = klineData.slice(1).map((k, i) => {
    const prevClose = klineData[i].close;
    return Math.max(
      k.high - k.low,
      Math.abs(k.high - prevClose),
      Math.abs(k.low - prevClose)
    );
  });

  const atr = trValues.reduce((sum, tr) => sum + tr, 0) / ATR_PERIOD;
  atrValues.push(atr);
  if (atrValues.length > ATR_PERIOD) atrValues.shift();
}

// Supertrend hesaplama
function calculateSupertrend() {
  const lastATR = atrValues[atrValues.length - 1];
  const currentKline = klineData[klineData.length - 1];

  const upperBand = (currentKline.high + currentKline.low) / 2 + MULTIPLIER * lastATR;
  const lowerBand = (currentKline.high + currentKline.low) / 2 - MULTIPLIER * lastATR;

  if (!supertrend.trend || supertrend.trend === 'down') {
    // Eğer trend 'down' ise ve 3 mum boyunca 'up' yönü devam ettiyse, trendi 'up' yap
    if (checkTrendDirection('up')) {
      supertrend.trend = 'up';
      supertrend.value = lowerBand;
    } else {
      supertrend.value = lowerBand;
    }
  } else if (supertrend.trend === 'up') {
    // Eğer trend 'up' ise ve 3 mum boyunca 'down' yönü devam ettiyse, trendi 'down' yap
    if (checkTrendDirection('down')) {
      supertrend.trend = 'down';
      supertrend.value = upperBand;
    } else {
      supertrend.value = upperBand;
    }
  }
}

// Trend yönünü kontrol et
function checkTrendDirection(direction) {
  let consecutiveCount = 0;

  // Son 3 mum verisini kontrol et
  for (let i = klineData.length - 1; i >= 0 && consecutiveCount < TREND_CHANGE_THRESHOLD; i--) {
    const currentKline = klineData[i];

    if (direction === 'up' && currentKline.close > currentKline.open) {
      consecutiveCount++;
    } else if (direction === 'down' && currentKline.close < currentKline.open) {
      consecutiveCount++;
    } else {
      break;
    }
  }

  // Eğer belirlediğimiz sayıda mum yönünde kalmışsa, trendi değiştirebiliriz
  return consecutiveCount >= TREND_CHANGE_THRESHOLD;
}


// Sinyal üretimi
function generateSignal(closePrice) {
  // Trendin aynı yönde devam ettiğini kontrol et
  if (checkTrendContinuity(supertrend.trend)) {
    if (supertrend.trend === 'up' && closePrice > supertrend.value) {
      console.log('Long pozisyon sinyali!');
      openPosition('long', closePrice);
    } else if (supertrend.trend === 'down' && closePrice < supertrend.value) {
      console.log('Short pozisyon sinyali!');
      openPosition('short', closePrice);
    }
    console.log(`Supertrend: ${supertrend.trend}, Seviye: ${supertrend.value}, Fiyat: ${closePrice}`);
  } else {
    console.log('Trend henüz yeterince güçlü değil. Sinyal geçersiz.');
  }
}

// WebSocket bağlantısı başlatma
function connectWebSocket() {
  ws = new WebSocket(BINANCE_FUTURES_WS);

  ws.on('open', () => {
    console.log('WebSocket bağlantısı kuruldu.');
    ws.send(JSON.stringify({
      method: 'SUBSCRIBE',
      params: ['btcusdt@kline_1m'],
      id: 1
    }));
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      if (message.e === 'kline' && message.k.x) { // Mum kapanışı tamamlandıysa
        const kline = {
          high: parseFloat(message.k.h),
          low: parseFloat(message.k.l),
          close: parseFloat(message.k.c)
        };
        klineData.push(kline);
        if (klineData.length > ATR_PERIOD + 1) klineData.shift();

        if (klineData.length >= ATR_PERIOD) {
          calculateATR();
          calculateSupertrend();
          generateSignal(kline.close);
        }

        updatePositions(parseFloat(message.k.c));
      }
    } catch (error) {
      console.error('Mesaj İşleme Hatası:', error);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket bağlantısı kapatıldı. Yeniden bağlanılıyor...');
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (error) => console.error('WebSocket Hatası:', error));
}

async function getHistoricalData(symbol, interval, limit) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  try {
    const response = await axios.get(url);
    return response.data.map(k => ({
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4])
    }));
  } catch (error) {
    console.error('Tarihsel veri alınırken hata oluştu:', error);
    return [];
  }
}


getHistoricalData('BTCUSDT', '1m', 50).then(res => {
  res.forEach(element => {
    klineData.push(element)
    console.log(`Geçmiş Veri Başarıyla eklendi : ${element}`)
  });
})
// Sistemi başlat
connectWebSocket();
