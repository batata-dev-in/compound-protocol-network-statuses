/**
 * Optimized Compound Protocol Data Fetcher
 * * Improvements:
 * 1. Removed Array.prototype pollution (replaced with modern async loops).
 * 2. Instantiated Web3 once per network instead of per token.
 * 3. Batched DOM updates to prevent layout thrashing.
 * 4. Improved error handling and configuration management.
 */

// ----------------------------------------------------------------------------
// Configuration & Constants
// ----------------------------------------------------------------------------

const CONFIG = {
  infuraId: '7db01e82204d4e789e22cf8e4f640ebe', // Consider moving to env variable
  endpoints: {
    cToken: 'https://api.compound.finance/api/v2/ctoken'
  }
};

// Dependency check
if (!window.protocolData || !window.erc20cTokenAbi || !window.comptrollerAbi) {
  console.error("Missing required global data (protocolData or ABIs).");
}

const protocolData = window.protocolData || {};
const erc20cTokenAbi = window.erc20cTokenAbi;
const comptrollerAbi = window.comptrollerAbi;
const networks = Object.keys(protocolData);

// Initialize Intl formatter once
const currencyFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 18
});

// ----------------------------------------------------------------------------
// Templates
// ----------------------------------------------------------------------------

const tableTemplate = Handlebars.compile(`
  <div class="max-width center" id="table-{{ uniqueId }}">
    <h3>{{ name }}</h3>
    <div>
      <table class="table">
        <thead>
          <tr>
            <th>Attribute Name</th>
            <th>Attribute Value</th>
            <th>Member Name</th>
            <th>Member Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Current Exchange Rate</td>
            <td>{{ textExchangeRate }}</td>
            <td>exchangeRateCurrent</td>
            <td>{{ exchangeRateCurrent }}</td>
          </tr>
          <tr>
            <td>Contract Holdings</td>
            <td>{{ textContractHoldings }}</td>
            <td>liquidityPoolTotal</td>
            <td>{{ liquidityPoolTotal }}</td>
          </tr>
          <tr>
            <td>Open Borrows Sum</td>
            <td>{{ textOpenBorrows }}</td>
            <td>totalBorrowsCurrent</td>
            <td>{{ totalBorrowsCurrent }}</td>
          </tr>
          <tr>
            <td>Supply Rate / Block</td>
            <td>{{ textSupplyRate }}</td>
            <td>supplyRatePerBlock</td>
            <td>{{ supplyRatePerBlock }}</td>
          </tr>
          <tr>
            <td>Borrow Rate / Block</td>
            <td>{{ textBorrowRate }}</td>
            <td>borrowRatePerBlock</td>
            <td>{{ borrowRatePerBlock }}</td>
          </tr>
          <tr>
            <td>cTokens in Circulation</td>
            <td>{{ textCTokenCirculation }}</td>
            <td>totalSupply, decimals</td>
            <td>totalSupply / (1 * 10 ^ decimals)</td>
          </tr>
          <tr>
            <td>Total Reserves</td>
            <td>{{ textReservesSum }}</td>
            <td>totalReserves</td>
            <td>{{ totalReserves }}</td>
          </tr>
          <tr>
            <td>Reserve Factor</td>
            <td>{{ textReserveFactor }}</td>
            <td>reserveFactorMantissa</td>
            <td>{{ reserveFactor }}</td>
          </tr>
          <tr>
            <td>Collateral Factor</td>
            <td>{{ textCollateralFactor }}</td>
            <td>comptroller.markets</td>
            <td>{{ collateralFactor.collateralFactorMantissa }}</td>
          </tr>
          <tr>
            <td>Underlying Address</td>
            <td>{{ underlyingAddress }}</td>
            <td>underlying</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
`);

const networkTemplate = Handlebars.compile(`
  <h2 class="capitalize">{{ this }}</h2>
  <div id="{{ this }}">
    <div class="loading-table">
      <div class="loader"></div>
    </div>
    <div class="tables-container"></div>
  </div>
`);

// ----------------------------------------------------------------------------
// Core Logic
// ----------------------------------------------------------------------------

// Setup Scroll Handler
const scrollTopBtn = document.getElementById('scroll-top');
if (scrollTopBtn) {
  scrollTopBtn.addEventListener('click', () => window.scrollTo(0, 0));
}

window.addEventListener('load', async () => {
  const navigation = document.getElementById('navigation');
  const networksContainer = document.getElementById('networks-container');
  
  if (!networksContainer) return;

  // 1. Render Network Skeletons
  networksContainer.innerHTML = networks.map(net => networkTemplate(net)).join('');

  // 2. Process each network
  for (const net of networks) {
    await processNetwork(net, navigation);
  }
});

async function processNetwork(networkName, navContainer) {
  const networkData = protocolData[networkName];
  const networkContainer = document.getElementById(networkName);
  const loadingElement = networkContainer.querySelector('.loading-table');
  const tablesContainer = networkContainer.querySelector('.tables-container');
  
  // Initialize Web3 ONCE per network
  const web3Instance = new Web3(`https://${networkName}.infura.io/v3/${CONFIG.infuraId}`);
  const comptrollerContract = new web3Instance.eth.Contract(comptrollerAbi, networkData.comptroller);

  // Create a DocumentFragment to batch DOM updates (Performance boost)
  const docFragment = document.createDocumentFragment();
  const navFragment = document.createDocumentFragment();

  // Use modern for...of loop instead of recursive callbacks
  // Allows for sequential execution to avoid rate-limiting, or use Promise.all for parallel
  for (const cToken of networkData.cTokens) {
    const symbol = cToken.symbol;
    const uniqueId = `${networkName}-${symbol}`;

    try {
      // Create placeholder in container if needed, or just append result later
      const data = await fetchCTokenData(
        web3Instance,
        cToken.token_address,
        comptrollerContract,
        symbol
      );
      
      data.name = cToken.name;
      data.uniqueId = uniqueId;

      // Create temporary container for HTML string
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = tableTemplate(data);
      docFragment.appendChild(tempDiv);

      // Update Navigation
      const navLink = document.createElement("a");
      navLink.href = `#${uniqueId}`;
      navLink.innerText = `${networkName} - ${symbol}`;
      navFragment.appendChild(navLink);
      navFragment.appendChild(document.createElement("br"));

    } catch (e) {
      console.error(`Failed to fetch data for ${networkName} ${symbol}:`, e);
    }
  }

  // Final DOM Update for this network
  loadingElement.classList.add('hidden');
  tablesContainer.appendChild(docFragment);
  if (navContainer) {
    navContainer.appendChild(navFragment);
  }
}

async function fetchCTokenData(web3, cTokenAddr, comptrollerContract, symbol) {
  const cTokenContract = new web3.eth.Contract(erc20cTokenAbi, cTokenAddr);

  // Parallel execution of independent read calls
  const [
    exchangeRateCurrent,
    liquidityPoolTotal,
    totalBorrowsCurrent,
    borrowRatePerBlock,
    totalSupply,
    supplyRatePerBlock,
    totalReserves,
    reserveFactor,
    collateralFactor,
    cTokenDecimals,
    underlyingAddress
  ] = await Promise.all([
    cTokenContract.methods.exchangeRateCurrent().call(),
    cTokenContract.methods.getCash().call(),
    cTokenContract.methods.totalBorrowsCurrent().call(),
    cTokenContract.methods.borrowRatePerBlock().call(),
    cTokenContract.methods.totalSupply().call(),
    cTokenContract.methods.supplyRatePerBlock().call(),
    cTokenContract.methods.totalReserves().call(),
    cTokenContract.methods.reserveFactorMantissa().call(),
    comptrollerContract.methods.markets(cTokenAddr).call(),
    cTokenContract.methods.decimals().call(),
    cTokenContract.methods.underlying().call().catch(() => 'N/A') // Handle tokens without underlying (e.g. cETH sometimes differs)
  ]);

  const cTokenMantissa = parseFloat('1e' + cTokenDecimals);
  
  // Note: Assuming 18 decimals for underlying in formatted text. 
  // For production, fetch underlying decimals dynamically.
  const standardMantissa = 1e18; 

  return {
    exchangeRateCurrent,
    liquidityPoolTotal,
    totalBorrowsCurrent,
    borrowRatePerBlock,
    totalSupply,
    supplyRatePerBlock,
    totalReserves,
    reserveFactor,
    collateralFactor,
    cTokenDecimals,
    underlyingAddress,
    textExchangeRate: `1 c${symbol} = ${currencyFormatter.format(exchangeRateCurrent / standardMantissa / 1e10)} ${symbol}`,
    textContractHoldings: `${currencyFormatter.format(liquidityPoolTotal / standardMantissa)} ${symbol}`,
    textOpenBorrows: `${currencyFormatter.format(totalBorrowsCurrent / standardMantissa)} ${symbol}`,
    textSupplyRate: `${(supplyRatePerBlock / standardMantissa).toFixed(18)} ${symbol} per ${symbol} supplied`,
    textBorrowRate: `${(borrowRatePerBlock / standardMantissa).toFixed(18)} ${symbol} per ${symbol} borrowed`,
    textCTokenCirculation: `${currencyFormatter.format(totalSupply / cTokenMantissa)} c${symbol}`,
    textReservesSum: `${currencyFormatter.format(totalReserves / standardMantissa)} ${symbol}`,
    textReserveFactor: `${reserveFactor / standardMantissa * 100}%`,
    textCollateralFactor: `${collateralFactor.collateralFactorMantissa / standardMantissa * 100}%`,
    textcTokenMantissa: cTokenMantissa
  };
}
