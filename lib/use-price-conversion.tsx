import { useRealtimePriceQuery, WalletCurrency } from "./graphql/generated"
import {
  DisplayCurrency,
  MoneyAmount,
  moneyAmountIsCurrencyType,
  WalletOrDisplayCurrency,
} from "./types/amounts"
import { useMemo } from "react"
import { gql } from "@apollo/client"

export const SATS_PER_BTC = 100000000

gql`
  query realtimePrice {
    me {
      id
      defaultAccount {
        id
        realtimePrice {
          btcSatPrice {
            base
            offset
          }
          denominatorCurrency
          id
          timestamp
          usdCentPrice {
            base
            offset
          }
        }
      }
    }
  }
`

export const usePriceConversion = () => {
  const { data } = useRealtimePriceQuery({})

  let displayCurrencyPerSat = NaN
  let displayCurrencyPerCent = NaN

  const realtimePrice = data?.me?.defaultAccount?.realtimePrice

  if (realtimePrice) {
    displayCurrencyPerSat =
      realtimePrice.btcSatPrice.base / 10 ** realtimePrice.btcSatPrice.offset
    displayCurrencyPerCent =
      realtimePrice.usdCentPrice.base / 10 ** realtimePrice.usdCentPrice.offset
  }

  const priceOfCurrencyInCurrency = useMemo(() => {
    if (!displayCurrencyPerSat || !displayCurrencyPerCent) {
      return undefined
    }

    // has units of denomiatedInCurrency/currency
    return (
      currency: WalletOrDisplayCurrency,
      inCurrency: WalletOrDisplayCurrency,
    ): number => {
      const priceOfCurrencyInCurrency = {
        [WalletCurrency.Btc]: {
          [DisplayCurrency]: displayCurrencyPerSat,
          [WalletCurrency.Usd]: displayCurrencyPerSat * (1 / displayCurrencyPerCent),
          [WalletCurrency.Btc]: 1,
        },
        [WalletCurrency.Usd]: {
          [DisplayCurrency]: displayCurrencyPerCent,
          [WalletCurrency.Btc]: displayCurrencyPerCent * (1 / displayCurrencyPerSat),
          [WalletCurrency.Usd]: 1,
        },
        [DisplayCurrency]: {
          [WalletCurrency.Btc]: 1 / displayCurrencyPerSat,
          [WalletCurrency.Usd]: 1 / displayCurrencyPerCent,
          [DisplayCurrency]: 1,
        },
      }
      return priceOfCurrencyInCurrency[currency][inCurrency]
    }
  }, [displayCurrencyPerSat, displayCurrencyPerCent])

  const convertMoneyAmount = useMemo(() => {
    if (!priceOfCurrencyInCurrency) {
      return undefined
    }

    return <T extends WalletOrDisplayCurrency>(
      moneyAmount: MoneyAmount<WalletOrDisplayCurrency>,
      toCurrency: T,
    ): MoneyAmount<T> => {
      // If the money amount is already the correct currency, return it
      if (moneyAmountIsCurrencyType(moneyAmount, toCurrency)) {
        return moneyAmount
      }

      return {
        amount: Math.round(
          moneyAmount.amount *
            priceOfCurrencyInCurrency(moneyAmount.currency, toCurrency),
        ),
        currency: toCurrency,
      }
    }
  }, [priceOfCurrencyInCurrency])

  return {
    convertMoneyAmount,
    usdPerSat: priceOfCurrencyInCurrency
      ? (priceOfCurrencyInCurrency(WalletCurrency.Btc, WalletCurrency.Usd) / 100).toFixed(
          8,
        )
      : null,
  }
}
