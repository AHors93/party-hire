const { dayCount } = require('./dates');

const round2 = (n) => Math.round(n * 100) / 100;
const roundUpTo50p = (n) => Math.ceil(n * 2) / 2;
const LITRES_PER_UK_GALLON = 4.546;

function hireQuote({ tables, chairs, start, end }, cfg) {
  const days = dayCount(start, end);
  const tablesCost = round2(tables * cfg.tablePrice * days);
  const chairsCost = round2(chairs * cfg.chairPrice * days);
  const hireTotal = round2(tablesCost + chairsCost);
  const deposit = cfg.depositPercent > 0 ? roundUpTo50p((hireTotal * cfg.depositPercent) / 100) : 0;
  return { days, tablesCost, chairsCost, hireTotal, deposit };
}

// oneWayMiles: home -> customer by road
function deliveryQuote(oneWayMiles, cfg) {
  const totalMiles = oneWayMiles * 2 * cfg.deliveryTrips;
  const fuelCost = (totalMiles / cfg.mpg) * LITRES_PER_UK_GALLON * cfg.fuelPricePerLitre;
  let fee;
  if (oneWayMiles <= cfg.freeDeliveryMiles) fee = 0;
  else fee = roundUpTo50p(Math.max(cfg.minDeliveryFee, fuelCost + cfg.deliveryBaseFee));
  return {
    oneWayMiles: round2(oneWayMiles),
    totalMiles: round2(totalMiles),
    fuelCost: round2(fuelCost),
    fee,
    outOfArea: cfg.maxDeliveryMiles > 0 && oneWayMiles > cfg.maxDeliveryMiles,
  };
}

module.exports = { hireQuote, deliveryQuote, round2 };
