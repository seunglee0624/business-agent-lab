package com.seunghyeon.harbortrade.currency;

public final class MoneyFormat {
	private MoneyFormat() {
	}

	/** Formats a copper amount like "3금 25은 10동". */
	public static String format(long copper) {
		if (copper == 0) {
			return "0동";
		}

		long gold = copper / Coin.GOLD.value();
		long silver = copper % Coin.GOLD.value() / Coin.SILVER.value();
		long rest = copper % Coin.SILVER.value();

		StringBuilder sb = new StringBuilder();
		if (gold > 0) sb.append(gold).append("금 ");
		if (silver > 0) sb.append(silver).append("은 ");
		if (rest > 0) sb.append(rest).append("동 ");
		return sb.toString().trim();
	}
}
