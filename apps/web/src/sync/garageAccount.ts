import { GarageLoadout, type LoadoutLease } from "./garageLoadout.js";
import { GarageShop, type ShopLease } from "./garageShop.js";

/** Garage state of the signed-in account: purchases and equipment, bound to the same lease. */
export class GarageAccount {
  readonly shop = new GarageShop();
  readonly loadout = new GarageLoadout();

  bind(lease?: ShopLease & LoadoutLease): void {
    this.shop.bind(lease);
    this.loadout.bind(lease);
  }
}
