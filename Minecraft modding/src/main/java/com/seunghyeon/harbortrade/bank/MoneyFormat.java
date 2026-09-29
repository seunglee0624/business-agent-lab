package com.seunghyeon.harbortrade.bank;

public final class MoneyFormat {
	private MoneyFormat() {
	}

	/** Formats a KD amount like "12,500 KD". */
	public static String format(long amount) {
		return String.format("%,d KD", amount);
	}
}
