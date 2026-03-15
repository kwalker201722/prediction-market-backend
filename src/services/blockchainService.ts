import { ethers } from 'ethers';
import { provider, getContract, getSignerContract } from '../config/blockchain';
import { Holding } from '../types';

export const getHoldings = async (
  walletAddress: string
): Promise<Holding[]> => {
  const contract = getContract();
  try {
    const raw: unknown[] = await contract.getHoldings(walletAddress);
    if (!Array.isArray(raw)) return [];
    return raw.map((h: unknown) => {
      const holding = h as { ticker: string; shares: bigint; value: bigint; lastPrice: bigint };
      return {
        ticker: holding.ticker,
        shares: Number(ethers.formatUnits(holding.shares, 18)),
        value: Number(ethers.formatUnits(holding.value, 18)),
        lastPrice: Number(ethers.formatUnits(holding.lastPrice, 18)),
      };
    });
  } catch (err) {
    console.error('getHoldings contract call failed:', err);
    return [];
  }
};

export const getEthBalance = async (
  walletAddress: string
): Promise<{ balance: string; formatted: string }> => {
  const balanceWei = await provider.getBalance(walletAddress);
  const formatted = ethers.formatEther(balanceWei);
  return { balance: balanceWei.toString(), formatted };
};

export const executeTrade = async (
  ticker: string,
  shares: number,
  price: number
): Promise<{ txHash: string }> => {
  const privateKey = process.env.BACKEND_WALLET_PRIVATE_KEY || '';
  if (!privateKey) throw new Error('Backend wallet not configured');

  const contract = getSignerContract(privateKey);
  const sharesWei = ethers.parseUnits(String(shares), 18);
  const priceWei = ethers.parseUnits(String(price), 18);

  const tx = await contract.executeTrade(ticker, sharesWei, priceWei);
  await tx.wait();
  return { txHash: tx.hash };
};
