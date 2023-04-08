import { useRouter } from "next/router"
import React, { useEffect } from "react"
import Container from "react-bootstrap/Container"
import Image from "react-bootstrap/Image"
import useRealtimePrice from "../../lib/use-realtime-price"
import { ACTION_TYPE, ACTIONS } from "../../pages/_reducer"
import { parseDisplayCurrency, safeAmount } from "../../utils/utils"
import Memo from "../Memo"
import DigitButton from "./Digit-Button"
import styles from "./parse-payment.module.css"
import ReceiveInvoice from "./Receive-Invoice"
import { useDisplayCurrency } from "../../lib/use-display-currency"
import { Currency, RealtimePriceWsSubscription } from "../../lib/graphql/generated"
import { ParsedUrlQuery } from "querystring"
import { SubscriptionResult } from "@apollo/client"

function isRunningStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches
}

interface Props {
  defaultWalletCurrency?: string
  walletId?: string
  dispatch: React.Dispatch<ACTION_TYPE>
  state: React.ComponentState
}

interface UpdateAmount {
  shouldUpdate: boolean
  value: string | null
}

export enum AmountUnit {
  Sat = "SAT",
  Cent = "CENT", // TODO: eventually depreciate this for Fiat, but don't want to break existing POS links
  Fiat = "FIAT",
}

const defaultCurrencyMetadata: Currency = {
  id: "USD",
  flag: "🇺🇸",
  name: "US Dollar",
  symbol: "$",
  fractionDigits: 2,
  __typename: "Currency",
}

function ParsePayment({ defaultWalletCurrency, walletId, dispatch, state }: Props) {
  const router = useRouter()
  const { username, amount, sats, unit, memo } = router.query
  const { display } = parseDisplayCurrency(router.query)
  const { currencyToSats, satsToCurrency, hasLoaded } = useRealtimePrice(
    display,
    handleRealtimePriceSubscriptionData,
  )
  const { currencyList } = useDisplayCurrency()
  const [valueInFiat, setValueInFiat] = React.useState("0.00")
  const [valueInSats, setValueInSats] = React.useState(0)
  const [currentAmount, setCurrentAmount] = React.useState(state.currentAmount)
  const [currencyMetadata, setCurrencyMetadata] = React.useState<Currency>(
    defaultCurrencyMetadata,
  )

  const prevUnit = React.useRef(AmountUnit.Cent)

  // onload
  // set all query params on first load, even if they are not passed
  useEffect(() => {
    console.log("<onload effect>")
    const initialUnit = unit ?? "SAT"
    const initialAmount = safeAmount(amount, undefined, "CENTS").toString()
    const initialSats = safeAmount(sats, undefined, "SAT").toString()
    const initialDisplay = display ?? "USD"
    const inititalQuery = { ...router.query }
    const initialUsername = router.query.username
    console.log("Initial query:", inititalQuery)
    delete inititalQuery?.currency
    const newQuery: ParsedUrlQuery = {
      amount: initialAmount,
      sats: initialSats,
      unit: initialUnit,
      memo: memo ?? "",
      display: initialDisplay,
      username: initialUsername,
    }
    console.log("New query:", newQuery)
    if (inititalQuery !== newQuery) {
      router.push(
        {
          pathname: `${username}`,
          query: {
            amount: initialAmount,
            sats: initialSats,
            unit: initialUnit,
            memo: memo ?? "",
            display: initialDisplay,
          },
        },
        undefined,
        { shallow: true },
      )
    }
    console.log("</onload effect>")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateCurrentAmountWithParams = React.useCallback((): UpdateAmount => {
    console.log("<updateCurrentAmountWithParams effect>")
    if (unit === AmountUnit.Sat) {
      if (sats === currentAmount) {
        return {
          shouldUpdate: false,
          value: null,
        }
      } else if (sats) {
        return {
          shouldUpdate: true,
          value: sats.toString(),
        }
      }
    } else {
      if (Number(amount) === Number(currentAmount)) {
        return { shouldUpdate: false, value: null }
      } else if (amount) {
        return { shouldUpdate: true, value: amount.toString() }
      }
    }
    console.log("</updateCurrentAmountWithParams effect>")
    return { shouldUpdate: false, value: null }
  }, [amount, sats, unit, currentAmount])

  const toggleCurrency = () => {
    const newUnit = unit === AmountUnit.Sat ? AmountUnit.Cent : AmountUnit.Sat
    prevUnit.current = (unit as AmountUnit) || AmountUnit.Cent
    router.push(
      {
        pathname: `${username}`,
        query: {
          currency: defaultWalletCurrency,
          unit: newUnit,
          memo,
          display,
          amount,
          sats,
        },
      },
      undefined,
      { shallow: true },
    )
  }

  // Update Params From Current Amount
  const handleAmountChange = (skipRouterPush?: boolean) => {
    console.log("<handleAmountChange effect>")
    if (!unit || currentAmount === "") return
    const { convertedCurrencyAmount } = satsToCurrency(
      currentAmount,
      display,
      currencyMetadata.fractionDigits,
    )
    let amt = unit === AmountUnit.Sat ? convertedCurrencyAmount : currentAmount
    if (unit === AmountUnit.Sat || currencyMetadata.fractionDigits === 0) {
      // format the fiat
      amt = safeAmount(amt, undefined, "SAT")
      amt =
        currencyMetadata.fractionDigits === 0
          ? amt.toFixed()
          : amt.toFixed(currencyMetadata.fractionDigits)
    }

    setValueInFiat(amt)
    console.log("amountConversion", amt)
    let sats =
      unit === AmountUnit.Sat
        ? currentAmount
        : currencyToSats(Number(currentAmount), display, currencyMetadata.fractionDigits)
            .convertedCurrencyAmount
    sats = safeAmount(sats, undefined, "SAT").toFixed()
    setValueInSats(sats)
    console.log("satsConversion", sats)
    const newQuery = {
      amount: amt,
      sats,
      currency: defaultWalletCurrency,
      unit,
      memo,
      display,
    }
    if (router.query !== newQuery && !skipRouterPush) {
      router.push(
        {
          pathname: `${username}`,
          query: newQuery,
        },
        undefined,
        { shallow: true },
      )
    }
    console.log("</handleAmountChange effect>")
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(handleAmountChange, [currentAmount, hasLoaded])

  function handleRealtimePriceSubscriptionData(
    subscriptionResult: SubscriptionResult<RealtimePriceWsSubscription>,
  ) {
    console.log(
      "got subscription data new realtime price",
      subscriptionResult?.data?.realtimePrice,
    )
  }

  React.useEffect(() => {
    console.log("<currentAmount change effect/>")
    setCurrentAmount(state.currentAmount)
  }, [state.currentAmount])

  // Toggle Current Amount
  React.useEffect(() => {
    console.log("<unit change effect>")
    if (!unit || unit === prevUnit.current) return
    if (unit === AmountUnit.Cent) {
      const { convertedCurrencyAmount } = currencyToSats(
        Number(amount),
        display,
        currencyMetadata.fractionDigits,
      )
      dispatch({
        type: ACTIONS.SET_AMOUNT_FROM_PARAMS,
        payload: convertedCurrencyAmount.toString(),
      })
    }
    if (unit === AmountUnit.Sat) {
      const { convertedCurrencyAmount } = satsToCurrency(
        Number(sats),
        display,
        currencyMetadata.fractionDigits,
      )
      dispatch({
        type: ACTIONS.SET_AMOUNT_FROM_PARAMS,
        payload: convertedCurrencyAmount?.toString(),
      })
    }
    console.log("</unit change effect>")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit])

  // Update CurrencyMetadata
  React.useEffect(() => {
    console.log("<display, currencyList effect>")
    const latestCurrencyMetadata = currencyList?.find((c) => c.id === display)
    if (latestCurrencyMetadata) {
      setCurrencyMetadata(latestCurrencyMetadata)
      console.log("update latestCurrencyMetadata", latestCurrencyMetadata)
    }
    console.log("</display, currencyList effect>")
  }, [display, currencyList])

  // Update Current Amount From Params
  React.useEffect(() => {
    console.log("<dispatch called>", amount, sats, unit)
    if (!unit || !sats || !amount) return
    const { shouldUpdate, value } = updateCurrentAmountWithParams()
    if (shouldUpdate && value) {
      dispatch({
        type: ACTIONS.SET_AMOUNT_FROM_PARAMS,
        payload: value?.toString(),
      })
    }
    console.log("</dispatch called>")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, sats, unit, dispatch])

  return (
    <Container className={styles.digits_container}>
      <div className={styles.output}>
        {!state.createdInvoice && !isRunningStandalone() && (
          <button
            onClick={() => {
              dispatch({
                type: ACTIONS.PINNED_TO_HOMESCREEN_MODAL_VISIBLE,
                payload: !state.pinnedToHomeScreenModalVisible,
              })
            }}
            className={styles.pin_btn}
          >
            <Image src="/icons/pin-icon.svg" alt="pin icon" className={styles.pin_icon} />
          </button>
        )}
        <div
          className={`${
            !unit || unit === AmountUnit.Cent ? styles.zero_order : styles.first_order
          }`}
        >
          {currencyMetadata.symbol}
          {valueInFiat}
        </div>
        <div
          className={`${unit === AmountUnit.Sat ? styles.zero_order : styles.first_order}
          }`}
        >
          {valueInSats} sats
        </div>
        {state.createdInvoice ? null : (
          <button title="toggle currency" onClick={() => toggleCurrency()}>
            <Image
              src="/icons/convert-icon.svg"
              alt="convert to SAT/USD icon"
              width="24"
              height="24"
            />
          </button>
        )}
      </div>

      <Memo createdInvoice={state.createdInvoice} />

      {state.createdInvoice ? (
        <ReceiveInvoice
          dispatch={dispatch}
          state={state}
          recipientWalletCurrency={defaultWalletCurrency}
          walletId={walletId}
        />
      ) : (
        <div className={styles.digits_grid}>
          <DigitButton digit={"1"} dispatch={dispatch} />
          <DigitButton digit={"2"} dispatch={dispatch} />
          <DigitButton digit={"3"} dispatch={dispatch} />
          <DigitButton digit={"4"} dispatch={dispatch} />
          <DigitButton digit={"5"} dispatch={dispatch} />
          <DigitButton digit={"6"} dispatch={dispatch} />
          <DigitButton digit={"7"} dispatch={dispatch} />
          <DigitButton digit={"8"} dispatch={dispatch} />
          <DigitButton digit={"9"} dispatch={dispatch} />
          <DigitButton
            digit={"."}
            dispatch={dispatch}
            disabled={unit === AmountUnit.Sat}
          />
          <DigitButton digit={"0"} dispatch={dispatch} />
          <button onClick={() => dispatch({ type: ACTIONS.DELETE_DIGIT })}>
            <Image
              src="/icons/backspace-icon.svg"
              alt="delete digit icon"
              width="32"
              height="32"
            />
          </button>
        </div>
      )}

      <div className={styles.pay_btn_container}>
        <button
          className={state.createdInvoice ? styles.pay_new_btn : styles.pay_btn}
          onClick={() => {
            if (state.createdInvoice) {
              dispatch({ type: ACTIONS.CREATE_NEW_INVOICE })
            } else {
              dispatch({ type: ACTIONS.CREATE_INVOICE, payload: amount?.toString() })
            }
          }}
        >
          <Image
            src={
              state.createdInvoice
                ? "/icons/lightning-icon-dark.svg"
                : "/icons/lightning-icon.svg"
            }
            alt="lightning icon"
            width="20"
            height="20"
          />
          {state.createdInvoice ? "Create new invoice" : "Create invoice"}
        </button>
        {!state.createdInvoice && (
          <button
            className={styles.clear_btn}
            onClick={() => dispatch({ type: ACTIONS.CLEAR_INPUT })}
          >
            <Image
              src="/icons/clear-input-icon.svg"
              alt="clear input icon"
              width="20"
              height="20"
            />
            Clear
          </button>
        )}
      </div>
    </Container>
  )
}

export default ParsePayment
