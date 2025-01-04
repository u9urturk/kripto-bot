const axios = require('axios');

// Binance API'den geçmiş kline verilerini al
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


async function backtest(symbol, interval, atrPeriods, multipliers) {
    const historicalData = await getHistoricalData(symbol, interval, 1000); // 500 mum verisi al

    if (historicalData.length < Math.max(...atrPeriods)) {
        console.log("Yeterli veri yok. Daha fazla veri alın.");
        return;
    }

    let bestPerformance = { atrPeriod: 0, multiplier: 0, winRate: 0 };
    for (const atrPeriod of atrPeriods) {
        for (const multiplier of multipliers) {
            let positions = [];
            let atrValues = [];
            let supertrend = {};

            // ATR Hesaplama
            const calculateATR = (data) => {
                const trValues = data.slice(1).map((k, i) => {
                    const prevClose = data[i].close;
                    return Math.max(
                        k.high - k.low,
                        Math.abs(k.high - prevClose),
                        Math.abs(k.low - prevClose)
                    );
                });
                return trValues.reduce((sum, tr) => sum + tr, 0) / atrPeriod;
            };

            // Supertrend Hesaplama
            const calculateSupertrend = (data) => {
                const lastATR = atrValues[atrValues.length - 1];
                const currentKline = data[data.length - 1];
                const upperBand = (currentKline.high + currentKline.low) / 2 + multiplier * lastATR;
                const lowerBand = (currentKline.high + currentKline.low) / 2 - multiplier * lastATR;

                if (!supertrend.trend || supertrend.trend === 'down') {
                    supertrend.trend = currentKline.close > lowerBand ? 'up' : 'down';
                    supertrend.value = lowerBand;
                } else if (supertrend.trend === 'up') {
                    supertrend.trend = currentKline.close < upperBand ? 'down' : 'up';
                    supertrend.value = upperBand;
                }
            };

            // Pozisyon Açma ve Güncelleme
            const openPosition = (direction, entryPrice) => {
                const targetPrice = direction === 'long' ? entryPrice * 1.01 : entryPrice * 0.99;
                const stopLoss = direction === 'long' ? entryPrice * 0.99 : entryPrice * 1.01;

                positions.push({
                    direction,
                    entryPrice,
                    targetPrice,
                    stopLoss,
                    status: 'open'
                });
            };

            const updatePositions = (currentPrice) => {
                positions = positions.map(position => {
                    if (position.status === 'open') {
                        if ((position.direction === 'long' && currentPrice >= position.targetPrice) ||
                            (position.direction === 'short' && currentPrice <= position.targetPrice)) {
                            position.status = 'closed';
                            position.result = 'TP';
                        } else if ((position.direction === 'long' && currentPrice <= position.stopLoss) ||
                            (position.direction === 'short' && currentPrice >= position.stopLoss)) {
                            position.status = 'closed';
                            position.result = 'SL';
                        }
                    }
                    return position;
                });
            };

            // Backtest Başlat
            for (let i = atrPeriod; i < historicalData.length; i++) {
                const dataSlice = historicalData.slice(i - atrPeriod, i + 1);
                atrValues.push(calculateATR(dataSlice));
                if (atrValues.length > atrPeriod) atrValues.shift();

                calculateSupertrend(dataSlice);

                const currentPrice = historicalData[i].close;
                if (supertrend.trend === 'up' && currentPrice > supertrend.value) {
                    openPosition('long', currentPrice);
                } else if (supertrend.trend === 'down' && currentPrice < supertrend.value) {
                    openPosition('short', currentPrice);
                }

                updatePositions(currentPrice);
            }

            // Performans Analizi
            const closedPositions = positions.filter(p => p.status === 'closed');
            const wins = closedPositions.filter(p => p.result === 'TP').length;
            const winRate = (wins / closedPositions.length) * 100;

            if (winRate > bestPerformance.winRate) {
                bestPerformance = { atrPeriod, multiplier, winRate };
            }
        }
    }

    console.log("En İyi Performans:", bestPerformance);
    return bestPerformance;
}

// Kullanım
const atrPeriods = [7, 14, 21, 28, 50]; // Farklı ATR Dönemleri
const multipliers = [1.5, 2, 2.5, 3, 3.5, 4]; // Farklı Çarpanlar
backtest('BTCUSDT', '1m', atrPeriods, multipliers);
