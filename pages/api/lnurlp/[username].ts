import crypto from "crypto"
import originalUrl from "original-url"
import { ApolloClient, HttpLink, InMemoryCache } from "@apollo/client"
import type { NextApiRequest, NextApiResponse } from "next"

import { GRAPHQL_URI } from "../../../lib/config"

import USER_WALLET_ID from "./user-wallet-id.gql"
import LNURL_INVOICE from "./lnurl-invoice.gql"

const client = new ApolloClient({
  link: new HttpLink({
    uri: GRAPHQL_URI,
  }),
  cache: new InMemoryCache(),
})

export default async function (req: NextApiRequest, res: NextApiResponse) {
  const { username, amount } = req.query
  const url = originalUrl(req)

  let walletId

  try {
    const { data } = await client.query({
      query: USER_WALLET_ID,
      variables: { username },
    })
    walletId = data.userDefaultWalletId
  } catch (err) {
    return res.json({
      status: "ERROR",
      reason: `Couldn't find user '${username}'.`,
    })
  }

  const metadata = JSON.stringify([
    ["text/plain", `Payment to ${username}`],
    ["text/identifier", `${username}@${url.hostname}`],
  ])

  if (amount) {
    if (Array.isArray(amount)) {
      throw new Error("Invalid request")
    }
    // second call, return invoice
    const amountSats = Math.round(parseInt(amount, 10) / 1000)
    if ((amountSats * 1000).toString() !== amount) {
      return res.json({
        status: "ERROR",
        reason: "Millisatoshi amount is not supported, please send a value in full sats.",
      })
    }

    try {
      const descriptionHash = crypto.createHash("sha256").update(metadata).digest("hex")

      const {
        data: {
          mutationData: { errors, invoice },
        },
      } = await client.mutate({
        mutation: LNURL_INVOICE,
        variables: {
          walletId,
          amount: amountSats,
          descriptionHash,
        },
      })

      if (errors && errors.length) {
        console.log("error getting invoice", errors)
        return res.json({
          status: "ERROR",
          reason: `Failed to get invoice: ${errors[0].message}`,
        })
      }

      res.json({
        pr: invoice.paymentRequest,
        routes: [],
      })
    } catch (err: unknown) {
      console.log("unexpected error getting invoice", err)
      res.json({
        status: "ERROR",
        reason: err instanceof Error ? err.message : "unexpected error",
      })
    }
  } else {
    // first call
    res.json({
      callback: url.full,
      minSendable: 1000,
      maxSendable: 500000000,
      metadata: metadata,
      tag: "payRequest",
    })
  }
}
