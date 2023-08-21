import { NextResponse } from "next/server"
import { URL } from "url"

import crypto from "crypto"
import {
  ApolloClient,
  ApolloLink,
  concat,
  gql,
  HttpLink,
  InMemoryCache,
} from "@apollo/client"
import Redis from "ioredis"

import { GRAPHQL_URI_INTERNAL, NOSTR_PUBKEY } from "../../../lib/config"
import {
  AccountDefaultWalletDocument,
  AccountDefaultWalletQuery,
  LnInvoiceCreateOnBehalfOfRecipientDocument,
  LnInvoiceCreateOnBehalfOfRecipientMutation,
} from "../../../lib/graphql/generated"

const ipForwardingMiddleware = new ApolloLink((operation, forward) => {
  operation.setContext(({ headers = {} }) => ({
    headers: {
      ...headers,
      "x-real-ip": operation.getContext()["x-real-ip"],
      "x-forwarded-for": operation.getContext()["x-forwarded-for"],
    },
  }))

  return forward(operation)
})

const client = new ApolloClient({
  link: concat(
    ipForwardingMiddleware,
    new HttpLink({
      uri: GRAPHQL_URI_INTERNAL,
    }),
  ),
  cache: new InMemoryCache(),
})

gql`
  query accountDefaultWallet($username: Username!, $walletCurrency: WalletCurrency!) {
    accountDefaultWallet(username: $username, walletCurrency: $walletCurrency) {
      __typename
      id
      walletCurrency
    }
  }

  mutation lnInvoiceCreateOnBehalfOfRecipient(
    $walletId: WalletId!
    $amount: SatAmount!
    $descriptionHash: Hex32Bytes!
  ) {
    mutationData: lnInvoiceCreateOnBehalfOfRecipient(
      input: {
        recipientWalletId: $walletId
        amount: $amount
        descriptionHash: $descriptionHash
      }
    ) {
      errors {
        message
      }
      invoice {
        paymentRequest
        paymentHash
      }
    }
  }
`

const nostrEnabled = !!NOSTR_PUBKEY

let redis: Redis | null = null

if (nostrEnabled) {
  const connectionObj = {
    sentinelPassword: process.env.REDIS_PASSWORD,
    sentinels: [
      {
        host: `${process.env.REDIS_0_DNS}`,
        port: 26379,
      },
      {
        host: `${process.env.REDIS_1_DNS}`,
        port: 26379,
      },
      {
        host: `${process.env.REDIS_2_DNS}`,
        port: 26379,
      },
    ],
    name: process.env.REDIS_MASTER_NAME ?? "mymaster",
    password: process.env.REDIS_PASSWORD,
  }

  redis = new Redis(connectionObj)

  redis.on("error", (err) => console.log({ err }, "Redis error"))
}

export async function GET(
  request: Request,
  { params }: { params: { username: string } },
) {
  console.log(NOSTR_PUBKEY)

  const { searchParams, hostname } = new URL(request.url)

  const username = params.username
  const amount = searchParams.get("amount")
  const nostr = searchParams.get("nostr")

  const accountUsername = username ? username.toString() : ""

  let walletId: string | null = null

  try {
    const { data } = await client.query<AccountDefaultWalletQuery>({
      query: AccountDefaultWalletDocument,
      variables: { username: accountUsername, walletCurrency: "BTC" },
      context: {
        "x-real-ip": request.headers.get("x-real-ip"),
        "x-forwarded-for": request.headers.get("x-forwarded-for"),
      },
    })
    walletId = data?.accountDefaultWallet?.id
  } catch (err: unknown) {
    console.log(err)
  }

  if (!walletId) {
    return NextResponse.json({
      status: "ERROR",
      reason: `Couldn't find user '${username}'.`,
    })
  }

  const metadata = JSON.stringify([
    ["text/plain", `Payment to ${accountUsername}`],
    ["text/identifier", `${accountUsername}@${hostname}`],
  ])

  // lnurl options call
  if (!amount) {
    return NextResponse.json({
      callback: request.url,
      minSendable: 1000,
      maxSendable: 100000000000,
      metadata,
      tag: "payRequest",
      ...(nostrEnabled
        ? {
            allowsNostr: true,
            nostrPubkey: NOSTR_PUBKEY,
          }
        : {}),
    })
  }

  // lnurl generate invoice
  try {
    if (Array.isArray(amount) || Array.isArray(nostr)) {
      throw new Error("Invalid request")
    }

    const amountSats = Math.round(parseInt(amount, 10) / 1000)
    if ((amountSats * 1000).toString() !== amount) {
      return NextResponse.json({
        status: "ERROR",
        reason: "Millisatoshi amount is not supported, please send a value in full sats.",
      })
    }

    let descriptionHash: string

    if (nostrEnabled && nostr) {
      descriptionHash = crypto.createHash("sha256").update(nostr).digest("hex")
    } else {
      descriptionHash = crypto.createHash("sha256").update(metadata).digest("hex")
    }

    const result = await client.mutate<LnInvoiceCreateOnBehalfOfRecipientMutation>({
      mutation: LnInvoiceCreateOnBehalfOfRecipientDocument,
      variables: {
        walletId,
        amount: amountSats,
        descriptionHash,
      },
    })

    const errors = result.errors
    const invoice = result.data?.mutationData?.invoice

    if ((errors && errors.length) || !invoice) {
      console.log("error getting invoice", errors)
      return NextResponse.json({
        status: "ERROR",
        reason: `Failed to get invoice: ${errors ? errors[0].message : "unknown error"}`,
      })
    }

    if (nostrEnabled && nostr && redis) {
      redis.set(`nostrInvoice:${invoice.paymentHash}`, nostr, "EX", 1440)
    }

    return NextResponse.json({
      pr: invoice.paymentRequest,
      routes: [],
    })
  } catch (err: unknown) {
    console.log("unexpected error getting invoice", err)
    NextResponse.json({
      status: "ERROR",
      reason: err instanceof Error ? err.message : "unexpected error",
    })
  }
}