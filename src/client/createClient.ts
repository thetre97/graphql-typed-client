import 'isomorphic-fetch'
import qs from 'querystring'
import { ExecutionResult, GraphQLError } from 'graphql'
import get from 'lodash.get'
import { applyTypeMapperToResponse, TypeMapper } from './applyTypeMapperToResponse'
import { chain } from './chain'
import { LinkedType } from './linkTypeMap'
import { Fields, Gql, requestToGql } from './requestToGql'

export class ClientError extends Error {
  constructor(message?: string, public errors?: ReadonlyArray<GraphQLError>) {
    super(errors ? `${message}\n${errors.map(error => JSON.stringify(error, null, 2)).join('\n')}` : message)

    new.target.prototype.name = new.target.name
    Object.setPrototypeOf(this, new.target.prototype)
    if (Error.captureStackTrace) Error.captureStackTrace(this, ClientError)
  }
}

export interface Fetcher {
  (gql: Gql, fetchImpl: typeof fetch, qsImpl: typeof qs): Promise<ExecutionResult<any>>
}

export interface Client<QR, QC, Q, MR, MC, M> {
  query(request: QR): Promise<ExecutionResult<Q>>
  mutation(request: MR): Promise<ExecutionResult<M>>
  chain: {
    query: QC
    mutation: MC
  }
}

export interface ClientOptions {
  fetcher?: Fetcher
}

export interface ClientEmbeddedOptions {
  queryRoot?: LinkedType
  mutationRoot?: LinkedType
  subscriptionRoot?: LinkedType
  typeMapper?: TypeMapper
}

export const createClient = <QR extends Fields, QC, Q, MR extends Fields, MC, M>({
  fetcher,
  queryRoot,
  mutationRoot,
  typeMapper,
}: ClientOptions & ClientEmbeddedOptions): Client<QR, QC, Q, MR, MC, M> => {
  const query = (request: QR): Promise<ExecutionResult<Q>> => {
    if (!fetcher) throw new Error('fetcher argument is missing')
    if (!queryRoot) throw new Error('queryRoot argument is missing')

    const resultPromise = fetcher(requestToGql('query', queryRoot, request, typeMapper), fetch, qs)

    return typeMapper
      ? resultPromise.then(result => applyTypeMapperToResponse(queryRoot, result, typeMapper))
      : resultPromise
  }

  const mutation = (request: MR): Promise<ExecutionResult<M>> => {
    if (!fetcher) throw new Error('fetcher argument is missing')
    if (!mutationRoot) throw new Error('mutationRoot argument is missing')

    const resultPromise = fetcher(requestToGql('mutation', mutationRoot, request, typeMapper), fetch, qs)

    return typeMapper
      ? resultPromise.then(result => applyTypeMapperToResponse(mutationRoot, result, typeMapper))
      : resultPromise
  }

  const mapResponse = (path: string[], defaultValue: any) => (response: ExecutionResult) => {
    if (response.errors) throw new ClientError(`Response contains errors`, response.errors)
    if (!response.data) throw new ClientError('Response data is empty')

    const result = get(response, ['data', ...path], defaultValue)

    if (result === undefined) throw new ClientError(`Response path \`${path.join('.')}\` is empty`)

    return result
  }

  return {
    query,
    mutation,
    chain: {
      query: <any>chain((path, request, defaultValue) => query(request).then(mapResponse(path, defaultValue))),
      mutation: <any>chain((path, request, defaultValue) => mutation(request).then(mapResponse(path, defaultValue))),
    },
  }
}
