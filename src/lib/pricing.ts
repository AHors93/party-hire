import { dayCount } from './dates';
import type { Config } from './config';
import type { DeliveryEstimate, HireQuote } from '../shared/types';

export const round2 = (n: number): number => Math.round(n * 100) / 100;
const roundUpTo50p = (n: number): number => Math.ceil(n * 2) / 2;
const LITRES_PER_UK_GALLON = 4.546;

type PricingConfig = Pick<Config, 'tablePrice' | 'chairPrice' | 'depositPercent'>;
type DeliveryConfig = Pick<
  Config,
  'deliveryTrips' | 'mpg' | 'fuelPricePerLitre' | 'freeDeliveryMiles' | 'minDeliveryFee' | 'deliveryBaseFee' | 'maxDeliveryMiles'
>;

export function hireQuote(
  { tables, chairs, start, end }: { tables: number; chairs: number; start: string; end: string },
  cfg: PricingConfig,
): HireQuote {
  const days = dayCount(start, end);
  const tablesCost = round2(tables * cfg.tablePrice * days);
  const chairsCost = round2(chairs * cfg.chairPrice * days);
  const hireTotal = round2(tablesCost + chairsCost);
  const deposit = cfg.depositPercent > 0 ? roundUpTo50p((hireTotal * cfg.depositPercent) / 100) : 0;
  return { days, tablesCost, chairsCost, hireTotal, deposit };
}

// oneWayMiles: home -> customer by road
export function deliveryQuote(oneWayMiles: number, cfg: DeliveryConfig): DeliveryEstimate {
  const totalMiles = oneWayMiles * 2 * cfg.deliveryTrips;
  const fuelCost = (totalMiles / cfg.mpg) * LITRES_PER_UK_GALLON * cfg.fuelPricePerLitre;
  let fee: number;
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
